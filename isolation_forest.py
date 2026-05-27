import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import classification_report, confusion_matrix
import joblib
from joblib import Memory

# -----------------------------
# Load processed dataset
# -----------------------------
df = pd.read_csv("processed_transactions.csv")

# -----------------------------
# Save labels for evaluation
# -----------------------------
y_true = df["Fraud_Label"]

# -----------------------------
# Remove columns NOT used for training
# -----------------------------
X = df.drop(["Fraud_Label", "Risk_Score"], axis=1)

# -----------------------------
# Create Isolation Forest model
# -----------------------------
model = IsolationForest(
    n_estimators=100,
    contamination=0.32,
    random_state=42
)

# -----------------------------
# Train model
# -----------------------------
model.fit(X)

# -----------------------------
# Predict anomalies
# -----------------------------
predictions = model.predict(X)

# Isolation Forest returns:
#  1  = normal
# -1  = anomaly

# Convert to:
# 0 = normal
# 1 = fraud/anomaly
predictions = [1 if p == -1 else 0 for p in predictions]

# -----------------------------
# Evaluation
# -----------------------------
print("Confusion Matrix:")
print(confusion_matrix(y_true, predictions))

print("\nClassification Report:")
print(classification_report(y_true, predictions))

joblib.dump(model, "isolation_forest_model.pkl")