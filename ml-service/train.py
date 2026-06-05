"""
train.py
--------
1. Generates synthetic data (calls generate_data.py)
2. Trains a Random Forest binary classifier
3. Evaluates the model
4. Saves the model as random_forest_model.pkl

Run:  python train.py
"""

import pandas as pd
import numpy as np
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    roc_auc_score,
    accuracy_score
)

# Import the generator
from generate_data import generate

# ------------------------------------------------------------------
# Step 1 – Generate data
# ------------------------------------------------------------------
print("=" * 55)
print("STEP 1: Generating synthetic transaction data")
print("=" * 55)

generate(n_normal=20000, n_fraud=3000, output="transactions.csv")

# ------------------------------------------------------------------
# Step 2 – Load and prepare data
# ------------------------------------------------------------------
print("\nSTEP 2: Loading and preparing data")
print("=" * 55)

df = pd.read_csv("transactions.csv")

print(f"Dataset shape: {df.shape}")
print(f"Fraud distribution:\n{df['is_fraud'].value_counts()}")

FEATURE_COLS = [
    "Transaction_Amount",
    "Hour",
    "DayOfWeek",
    "Is_Weekend",
    "Location_Rijeka",
    "Location_Zagreb",
    "Location_Split",
    "Location_Osijek",
    "Location_Dubrovnik",
    "Location_Foreign",
    "Merchant_Category_Food",
    "Merchant_Category_Coffee",
    "Merchant_Category_Groceries",
    "Merchant_Category_Electronics",
    "Merchant_Category_Clothing",
    "Merchant_Category_Travel",
    "Merchant_Category_Health",
    "Merchant_Category_Entertainment",
]

X = df[FEATURE_COLS]
y = df["is_fraud"]

X_train, X_test, y_train, y_test = train_test_split(
    X, y,
    test_size=0.2,
    random_state=42,
    stratify=y          # keep fraud ratio consistent in both splits
)

print(f"Training set: {len(X_train)} rows")
print(f"Test set:     {len(X_test)} rows")

# ------------------------------------------------------------------
# Step 3 – Train Random Forest
# ------------------------------------------------------------------
print("\nSTEP 3: Training Random Forest")
print("=" * 55)

# class_weight='balanced' compensates for the fraud minority class
model = RandomForestClassifier(
    n_estimators=150,
    max_depth=12,
    min_samples_leaf=5,
    class_weight="balanced",
    random_state=42,
    n_jobs=-1
)

model.fit(X_train, y_train)
print("Training complete.")

# ------------------------------------------------------------------
# Step 4 – Evaluate
# ------------------------------------------------------------------
print("\nSTEP 4: Evaluation")
print("=" * 55)

y_pred  = model.predict(X_test)
y_proba = model.predict_proba(X_test)[:, 1]

print(f"Accuracy : {accuracy_score(y_test, y_pred):.4f}")
print(f"ROC-AUC  : {roc_auc_score(y_test, y_proba):.4f}")

print("\nClassification report:")
print(classification_report(y_test, y_pred, target_names=["Normal", "Fraud"]))

print("Confusion matrix (rows=actual, cols=predicted):")
cm = confusion_matrix(y_test, y_pred)
print(f"  True Normal  / False Fraud : {cm[0][0]} / {cm[0][1]}")
print(f"  False Normal / True Fraud  : {cm[1][0]} / {cm[1][1]}")

# Cross-validation on the full dataset (5-fold)
print("\nCross-validation ROC-AUC (5-fold):")
cv_scores = cross_val_score(model, X, y, cv=5, scoring="roc_auc", n_jobs=-1)
print(f"  Scores : {np.round(cv_scores, 4)}")
print(f"  Mean   : {cv_scores.mean():.4f}  ±  {cv_scores.std():.4f}")

# Feature importances (top 10)
importances = pd.Series(model.feature_importances_, index=FEATURE_COLS)
print("\nTop 10 feature importances:")
print(importances.sort_values(ascending=False).head(10).to_string())

# ------------------------------------------------------------------
# Step 5 – Save model + feature list
# ------------------------------------------------------------------
print("\nSTEP 5: Saving model")
print("=" * 55)

joblib.dump(model,        "random_forest_model.pkl")
joblib.dump(FEATURE_COLS, "feature_cols.pkl")

print("Saved: random_forest_model.pkl")
print("Saved: feature_cols.pkl")
print("\nDone.")
