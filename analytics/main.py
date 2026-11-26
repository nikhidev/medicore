from hmac import compare_digest
from os import environ
from statistics import mean
from typing import Annotated, Literal
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, FiniteFloat, model_validator

app = FastAPI(title="MediCore operations analytics", version="1.0")
Number = Annotated[FiniteFloat, Field(ge=0)]
UNITS = {"Hemoglobin": "g/dL", "Glucose": "mg/dL", "Creatinine": "mg/dL"}


class Appointment(BaseModel):
    status: Literal["scheduled", "checked_in", "completed", "cancelled"]
    wait: Number | None


class Lab(BaseModel):
    test: Literal["Hemoglobin", "Glucose", "Creatinine"]
    value: Number
    unit: str
    low: Number
    high: Number
    turnaround: Number

    @model_validator(mode="after")
    def validate_metadata(self):
        if UNITS[self.test] != self.unit or self.low > self.high:
            raise ValueError("Invalid unit or reference interval")
        return self


class Population(BaseModel):
    band: Literal["0–17", "18–64", "65+"]
    count: Annotated[int, Field(ge=0)]


class Dataset(BaseModel):
    appointments: list[Appointment] = Field(max_length=10000)
    labs: list[Lab] = Field(max_length=10000)
    population: list[Population] = Field(max_length=3)
    available: Number = 0
    booked: Number = 0


@app.exception_handler(RequestValidationError)
async def invalid_dataset(_request: Request, _error: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "Dataset validation failed."})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/report")
def report(data: Dataset, x_service_key: Annotated[str, Header()] = ""):
    expected = environ.get("ANALYTICS_KEY")
    if not expected or not compare_digest(x_service_key.encode(), expected.encode()):
        raise HTTPException(401, "Invalid service credentials")
    attendance = [item for item in data.appointments if item.status != "cancelled"]
    waits = [item.wait for item in attendance if item.wait is not None]
    checkins = sum(item.status in ("checked_in", "completed") for item in attendance)
    population = {}
    for item in data.population:
        population[item.band] = population.get(item.band, 0) + item.count
    return {
        "appointmentCount": len(data.appointments),
        "scheduleUtilization30Days": round(data.booked / data.available, 4) if data.available else None,
        "attendanceRate": round(checkins / len(attendance), 4) if attendance else None,
        "meanWaitMinutes": round(mean(waits), 2) if waits else None,
        "meanLabTurnaroundMinutes": round(mean(item.turnaround for item in data.labs), 2) if data.labs else None,
        "populationByAge": population,
    }
