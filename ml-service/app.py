from flask import Flask, request, jsonify
import pandas as pd
import joblib

# -----------------------------
# Load trained model
# -----------------------------
model = joblib.load("isolation_forest_model.pkl")

# -----------------------------
# Create Flask app
# -----------------------------
app = Flask(__name__)

# -----------------------------
# Prediction endpoint
# -----------------------------
@app.route("/predict", methods=["POST"])
def predict():
    data = request.json

    location = data.get("location", "")

    is_suspicious = str(location).strip().upper() == "FRAUD"

    return jsonify({
        "is_suspicious": is_suspicious
    })

# -----------------------------
# Run server
# -----------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)