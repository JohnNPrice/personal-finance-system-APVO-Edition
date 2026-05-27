import pandas as pd

# Load original dataset
df = pd.read_csv("synthetic_fraud_dataset.csv")

# Columns to keep
columns_to_keep = [
    "Timestamp",
    "Transaction_Amount",
    "Location",
    "Merchant_Category",
    "Is_Weekend",
    "Risk_Score",
    "Fraud_Label"

]

# Keep only selected columns
df_cleaned = df[columns_to_keep]

# Save cleaned dataset
df_cleaned.to_csv("cleaned_transactions.csv", index=False)

print("Cleaned dataset saved as cleaned_transactions.csv")
print(df_cleaned.head())