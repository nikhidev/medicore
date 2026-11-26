from fastapi.testclient import TestClient
from main import app

client = TestClient(app)
HEADERS = {"X-Service-Key": "test-key"}
DATA = {"appointments": [{"status": "completed", "wait": 6}], "labs": [
    {"test": "Glucose", "value": 92, "unit": "mg/dL", "low": 80, "high": 110, "turnaround": 35}
], "population": [{"band": "18–64", "count": 4}], "available": 100, "booked": 25}


def test_report(monkeypatch):
    monkeypatch.setenv("ANALYTICS_KEY", "test-key")
    response = client.post("/report", json=DATA, headers=HEADERS)
    assert response.json() == {"appointmentCount": 1, "attendanceRate": 1.0, "scheduleUtilization30Days": 0.25,
                               "meanWaitMinutes": 6.0, "meanLabTurnaroundMinutes": 35.0,
                               "populationByAge": {"18–64": 4}}


def test_requires_credentials(monkeypatch):
    monkeypatch.setenv("ANALYTICS_KEY", "test-key")
    assert client.post("/report", json=DATA).status_code == 401


def test_rejects_invalid_metadata():
    lab = {**DATA["labs"][0], "unit": "g/dL"}
    response = client.post("/report", json={**DATA, "labs": [lab]}, headers=HEADERS)
    assert response.status_code == 422
    assert response.json() == {"detail": "Dataset validation failed."}


def test_empty_dataset(monkeypatch):
    monkeypatch.setenv("ANALYTICS_KEY", "test-key")
    result = client.post("/report", json={"appointments": [],"labs": [],"population": []}, headers=HEADERS).json()
    assert result["meanWaitMinutes"] is None
    assert result["attendanceRate"] is None
