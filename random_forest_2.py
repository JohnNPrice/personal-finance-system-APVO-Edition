import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix

# -----------------------------
# Load processed dataset
# -----------------------------
df = pd.read_csv("processed_transactions.csv")

# -----------------------------
# Features and labels
# -----------------------------
X = df.drop(["Fraud_Label", "Risk_Score"], axis=1)
y = df["Fraud_Label"]

# -----------------------------
# Split dataset
# -----------------------------
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42
)

# -----------------------------
# Create Random Forest model
# -----------------------------
model = RandomForestClassifier(
    n_estimators=200,
    max_depth=10,
    class_weight="balanced",
    random_state=42
)

# -----------------------------
# Train model
# -----------------------------
model.fit(X_train, y_train)

# -----------------------------
# Predict
# -----------------------------
predictions = model.predict(X_test)

# -----------------------------
# Evaluation
# -----------------------------
print("Confusion Matrix:")
print(confusion_matrix(y_test, predictions))

print("\nClassification Report:")
print(classification_report(y_test, predictions))