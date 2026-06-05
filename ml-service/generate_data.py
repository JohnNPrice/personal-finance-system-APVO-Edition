"""
generate_data.py
----------------
Generates a synthetic transaction dataset for fraud detection.
Tailored to realistic spending patterns in Rijeka, Croatia.

Run:  python generate_data.py
Output: transactions.csv
"""

import random
import csv
from datetime import datetime, timedelta

random.seed(42)

# ------------------------------------------------------------------
# Domain config – Rijeka/Croatia context
# ------------------------------------------------------------------

LOCATIONS = [
    "Rijeka", "Zagreb", "Split", "Osijek", "Dubrovnik",
    "London", "Vienna", "Berlin", "Paris", "Amsterdam"
]

CATEGORIES = [
    "Food", "Coffee", "Groceries", "Electronics",
    "Clothing", "Travel", "Health", "Entertainment"
]

# Typical spending ranges per category (EUR), normal behaviour
NORMAL_SPEND = {
    "Food":          (5,   35),
    "Coffee":        (1.5,  6),
    "Groceries":     (10,  80),
    "Electronics":   (15, 200),
    "Clothing":      (10, 120),
    "Travel":        (20, 300),
    "Health":        (5,   60),
    "Entertainment": (5,   40),
}

# Fraud spend – unusually high
FRAUD_SPEND = {
    "Food":          (400,  900),
    "Coffee":        (300,  700),
    "Groceries":     (500, 1200),
    "Electronics":   (800, 3000),
    "Clothing":      (600, 2500),
    "Travel":        (1500, 5000),
    "Health":        (700, 2000),
    "Entertainment": (500, 1800),
}

# Hours considered high-risk (late night)
FRAUD_HOURS = list(range(0, 5))          # 00:00 – 04:59
NORMAL_HOURS = list(range(6, 23))        # 06:00 – 22:59

START_DATE = datetime(2024, 1, 1)
END_DATE   = datetime(2025, 12, 31)


def random_date(start: datetime, end: datetime) -> datetime:
    delta = end - start
    return start + timedelta(seconds=random.randint(0, int(delta.total_seconds())))


def make_normal_transaction() -> dict:
    category = random.choice(CATEGORIES)
    lo, hi   = NORMAL_SPEND[category]
    amount   = round(random.uniform(lo, hi), 2)

    dt       = random_date(START_DATE, END_DATE)
    # Normal hours – occasionally evening, rarely night
    hour     = random.choice(NORMAL_HOURS + [23] * 2)
    dt       = dt.replace(hour=hour, minute=random.randint(0, 59))

    location = random.choices(
        LOCATIONS,
        # Rijeka/Zagreb much more likely for normal transactions
        weights=[40, 20, 10, 5, 5, 4, 4, 4, 4, 4],
        k=1
    )[0]

    return {
        "Transaction_Amount":           amount,
        "Hour":                         dt.hour,
        "DayOfWeek":                    dt.weekday(),      # 0=Mon … 6=Sun
        "Is_Weekend":                   1 if dt.weekday() >= 5 else 0,
        "Location_Rijeka":              1 if location == "Rijeka"      else 0,
        "Location_Zagreb":              1 if location == "Zagreb"      else 0,
        "Location_Split":               1 if location == "Split"       else 0,
        "Location_Osijek":              1 if location == "Osijek"      else 0,
        "Location_Dubrovnik":           1 if location == "Dubrovnik"   else 0,
        "Location_Foreign":             1 if location in ("London","Vienna","Berlin","Paris","Amsterdam") else 0,
        "Merchant_Category_Food":       1 if category == "Food"          else 0,
        "Merchant_Category_Coffee":     1 if category == "Coffee"        else 0,
        "Merchant_Category_Groceries":  1 if category == "Groceries"     else 0,
        "Merchant_Category_Electronics":1 if category == "Electronics"   else 0,
        "Merchant_Category_Clothing":   1 if category == "Clothing"      else 0,
        "Merchant_Category_Travel":     1 if category == "Travel"        else 0,
        "Merchant_Category_Health":     1 if category == "Health"        else 0,
        "Merchant_Category_Entertainment": 1 if category == "Entertainment" else 0,
        "is_fraud": 0
    }


def make_fraud_transaction() -> dict:
    """
    Fraud patterns:
      1. Very high amount for the category
      2. Late-night / early-morning hour
      3. Foreign location with high amount
      4. Rapid succession implied by odd hour + high amount
    A transaction needs at least ONE of these to be labelled fraud.
    """
    # Pick a fraud pattern
    pattern = random.choice(["high_amount", "night_foreign", "night_high"])

    category = random.choice(CATEGORIES)
    dt       = random_date(START_DATE, END_DATE)

    if pattern == "high_amount":
        lo, hi   = FRAUD_SPEND[category]
        amount   = round(random.uniform(lo, hi), 2)
        hour     = random.choice(NORMAL_HOURS)           # normal hour, suspicious amount
        location = random.choice(LOCATIONS)

    elif pattern == "night_foreign":
        lo, hi   = NORMAL_SPEND[category]
        # amount can be moderate but foreign + night = risky
        amount   = round(random.uniform(lo * 3, hi * 5), 2)
        hour     = random.choice(FRAUD_HOURS)
        location = random.choice(["London","Vienna","Berlin","Paris","Amsterdam"])

    else:  # night_high
        lo, hi   = FRAUD_SPEND[category]
        amount   = round(random.uniform(lo, hi), 2)
        hour     = random.choice(FRAUD_HOURS)
        location = random.choice(LOCATIONS)

    dt = dt.replace(hour=hour, minute=random.randint(0, 59))

    return {
        "Transaction_Amount":           amount,
        "Hour":                         dt.hour,
        "DayOfWeek":                    dt.weekday(),
        "Is_Weekend":                   1 if dt.weekday() >= 5 else 0,
        "Location_Rijeka":              1 if location == "Rijeka"      else 0,
        "Location_Zagreb":              1 if location == "Zagreb"      else 0,
        "Location_Split":               1 if location == "Split"       else 0,
        "Location_Osijek":              1 if location == "Osijek"      else 0,
        "Location_Dubrovnik":           1 if location == "Dubrovnik"   else 0,
        "Location_Foreign":             1 if location in ("London","Vienna","Berlin","Paris","Amsterdam") else 0,
        "Merchant_Category_Food":       1 if category == "Food"          else 0,
        "Merchant_Category_Coffee":     1 if category == "Coffee"        else 0,
        "Merchant_Category_Groceries":  1 if category == "Groceries"     else 0,
        "Merchant_Category_Electronics":1 if category == "Electronics"   else 0,
        "Merchant_Category_Clothing":   1 if category == "Clothing"      else 0,
        "Merchant_Category_Travel":     1 if category == "Travel"        else 0,
        "Merchant_Category_Health":     1 if category == "Health"        else 0,
        "Merchant_Category_Entertainment": 1 if category == "Entertainment" else 0,
        "is_fraud": 1
    }


def generate(n_normal: int = 20000, n_fraud: int = 3000, output: str = "transactions.csv"):
    rows = []
    for _ in range(n_normal):
        rows.append(make_normal_transaction())
    for _ in range(n_fraud):
        rows.append(make_fraud_transaction())

    random.shuffle(rows)

    fieldnames = list(rows[0].keys())
    with open(output, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"[generate_data] Written {n_normal} normal + {n_fraud} fraud = {n_normal+n_fraud} rows → {output}")


if __name__ == "__main__":
    generate()
