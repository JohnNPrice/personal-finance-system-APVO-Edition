from flask import Flask, request, jsonify
import pandas as pd
import joblib

# ------------------------------------------------------------------
# Load trained model and expected feature columns
# ------------------------------------------------------------------
model       = joblib.load("random_forest_model.pkl")
FEATURE_COLS = joblib.load("feature_cols.pkl")

# ------------------------------------------------------------------
# Flask app
# ------------------------------------------------------------------
app = Flask(__name__)

# ------------------------------------------------------------------
# Helper – map raw request fields to model feature vector
# ------------------------------------------------------------------
def build_features(data: dict) -> pd.DataFrame:
    """
    Accepts the same JSON that server.js already sends
    (Transaction_Amount, Hour, DayOfWeek, Is_Weekend,
     Location_* one-hot, Merchant_Category_* one-hot)
    and returns a single-row DataFrame with exactly the columns
    the model was trained on.

    Fields that the old model used (Location_London, Location_Mumbai …)
    are mapped to Location_Foreign so the backend doesn't need changing.
    """

    # ------ amount / time ------
    amount      = float(data.get("Transaction_Amount", 0))
    hour        = int(data.get("Hour", 12))
    day_of_week = int(data.get("DayOfWeek", 0))
    is_weekend  = int(data.get("Is_Weekend", 0))

    # ------ location ------
    # server.js sends Location_London / Location_Mumbai / … (old columns)
    # OR the new Location_* columns if you update it later.
    # We unify everything into the 6 columns the model knows.
    loc_rijeka    = int(data.get("Location_Rijeka",    0))
    loc_zagreb    = int(data.get("Location_Zagreb",    0))
    loc_split     = int(data.get("Location_Split",     0))
    loc_osijek    = int(data.get("Location_Osijek",    0))
    loc_dubrovnik = int(data.get("Location_Dubrovnik", 0))

    # Old server.js sends London/Mumbai/New_York/Sydney/Tokyo → treat as Foreign
    old_foreign = (
        int(data.get("Location_London",   0)) +
        int(data.get("Location_Mumbai",   0)) +
        int(data.get("Location_New_York", 0)) +
        int(data.get("Location_Sydney",   0)) +
        int(data.get("Location_Tokyo",    0))
    )
    loc_foreign = min(1, int(data.get("Location_Foreign", 0)) + old_foreign)

    # ------ category ------
    # server.js already sends Merchant_Category_* columns
    cat_food    = int(data.get("Merchant_Category_Food",          0))
    cat_coffee  = int(data.get("Merchant_Category_Coffee",        0))
    cat_grocery = int(data.get("Merchant_Category_Groceries",     0))
    cat_elec    = int(data.get("Merchant_Category_Electronics",   0))
    cat_cloth   = int(data.get("Merchant_Category_Clothing",      0))
    cat_travel  = int(data.get("Merchant_Category_Travel",        0))
    cat_health  = int(data.get("Merchant_Category_Health",        0))
    cat_ent     = int(data.get("Merchant_Category_Entertainment", 0))

    # Old server.js "Restaurants" → Food
    cat_food = min(1, cat_food + int(data.get("Merchant_Category_Restaurants", 0)))

    row = {
        "Transaction_Amount":              amount,
        "Hour":                            hour,
        "DayOfWeek":                       day_of_week,
        "Is_Weekend":                      is_weekend,
        "Location_Rijeka":                 loc_rijeka,
        "Location_Zagreb":                 loc_zagreb,
        "Location_Split":                  loc_split,
        "Location_Osijek":                 loc_osijek,
        "Location_Dubrovnik":              loc_dubrovnik,
        "Location_Foreign":                loc_foreign,
        "Merchant_Category_Food":          cat_food,
        "Merchant_Category_Coffee":        cat_coffee,
        "Merchant_Category_Groceries":     cat_grocery,
        "Merchant_Category_Electronics":   cat_elec,
        "Merchant_Category_Clothing":      cat_cloth,
        "Merchant_Category_Travel":        cat_travel,
        "Merchant_Category_Health":        cat_health,
        "Merchant_Category_Entertainment": cat_ent,
    }

    return pd.DataFrame([row], columns=FEATURE_COLS)


# ------------------------------------------------------------------
# Prediction endpoint  –  identical contract to the old app.py
# ------------------------------------------------------------------
@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json(force=True)

    df         = build_features(data)
    prediction = model.predict(df)[0]          # 0 = normal, 1 = fraud
    probability = model.predict_proba(df)[0][1] # P(fraud)

    return jsonify({
        "is_suspicious": bool(prediction == 1),
        "fraud_probability": round(float(probability), 4)
    })


# ------------------------------------------------------------------
# Health check
# ------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "model": "random_forest"})


# ------------------------------------------------------------------
# Run (dev only – production uses gunicorn via Dockerfile)
# ------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
