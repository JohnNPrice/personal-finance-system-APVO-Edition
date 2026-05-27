import pandas as pd
from sklearn.preprocessing import LabelEncoder

# Load cleaned dataset
df = pd.read_csv("cleaned_transactions.csv")

# -----------------------------
# Convert Timestamp
# -----------------------------
df["Timestamp"] = pd.to_datetime(df["Timestamp"])

# Extract useful time features
df["Hour"] = df["Timestamp"].dt.hour
df["DayOfWeek"] = df["Timestamp"].dt.dayofweek

# Remove original timestamp
df = df.drop("Timestamp", axis=1)

# -----------------------------
# Encode categorical columns
# -----------------------------
# One-hot encode categorical columns
df = pd.get_dummies(
    df,
    columns=["Location", "Merchant_Category"]
)

# -----------------------------
# Convert boolean column
# -----------------------------
df["Is_Weekend"] = df["Is_Weekend"].astype(int)

# -----------------------------
# Remove missing values
# -----------------------------
df = df.dropna()

# -----------------------------
# Save processed dataset
# -----------------------------
df.to_csv("processed_transactions.csv", index=False)

print("Processed dataset saved as processed_transactions.csv")
print(df.head())