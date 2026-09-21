"""
AI-Based Scam Transaction Risk Model
Uses Random Forest + rule-based heuristics for explainable predictions.
"""

import numpy as np
import json
from datetime import datetime


# ---------------------------------------------------------------------------
# Feature engineering helpers
# ---------------------------------------------------------------------------

def _hour_risk(hour: int) -> float:
    """Late-night / early-morning hours are riskier."""
    if 0 <= hour < 6:
        return 1.0
    if 6 <= hour < 9 or 22 <= hour < 24:
        return 0.5
    return 0.0


def _amount_zscore(amount: float, avg: float, std: float) -> float:
    if std == 0:
        return 0.0
    return (amount - avg) / std


def _payment_method_risk(method: str) -> float:
    risky = {"crypto": 1.0, "wire transfer": 0.8, "gift card": 1.0,
             "e-wallet": 0.4, "upi": 0.3, "net banking": 0.2,
             "debit card": 0.1, "credit card": 0.15}
    return risky.get(method.lower().strip(), 0.3)


def _location_risk(user_location: str, txn_location: str) -> float:
    if not user_location or not txn_location:
        return 0.2
    if user_location.strip().lower() != txn_location.strip().lower():
        return 0.7
    return 0.0


def _frequency_risk(txn_count_last_hour: int) -> float:
    if txn_count_last_hour >= 10:
        return 1.0
    if txn_count_last_hour >= 5:
        return 0.6
    if txn_count_last_hour >= 3:
        return 0.3
    return 0.0


# ---------------------------------------------------------------------------
# Core scoring engine
# ---------------------------------------------------------------------------

class ScamRiskModel:
    """
    Rule + heuristic weighted model that returns:
      - risk_score  : 0–100
      - label       : 'Safe' | 'Suspicious' | 'High Risk'
      - reasons     : list[str]  (plain-language explanations)
      - tips        : list[str]  (personalised safety advice)
    """

    WEIGHTS = {
        "amount":    0.30,
        "hour":      0.15,
        "method":    0.20,
        "location":  0.20,
        "frequency": 0.15,
    }

    def predict(self, data: dict) -> dict:
        scores = {}
        reasons = []
        tips = []

        # --- Amount analysis ---
        amount = float(data.get("amount", 0))
        avg_amount = float(data.get("avg_amount", 500))
        std_amount = float(data.get("std_amount", 300))
        zscore = _amount_zscore(amount, avg_amount, std_amount)
        amount_score = min(abs(zscore) / 4.0, 1.0)   # normalise to 0-1
        scores["amount"] = amount_score
        if zscore > 2.5:
            reasons.append(
                f"This transaction amount (₹{amount:,.0f}) is significantly higher "
                f"than your usual transaction amount (₹{avg_amount:,.0f})."
            )
        elif zscore < -1.5 and amount > 0:
            reasons.append(
                "The transaction amount is unusually small, which can sometimes "
                "indicate a test transaction before a larger fraud attempt."
            )

        # --- Time analysis ---
        txn_time = data.get("time", "")
        try:
            hour = datetime.strptime(txn_time, "%H:%M").hour
        except ValueError:
            hour = datetime.now().hour
        hour_score = _hour_risk(hour)
        scores["hour"] = hour_score
        if hour_score >= 0.5:
            reasons.append(
                f"This transaction was initiated at {txn_time or hour}:00, "
                "which is an unusual hour (late night / early morning). "
                "Scammers often operate at odd hours."
            )

        # --- Payment method ---
        method = data.get("payment_method", "")
        method_score = _payment_method_risk(method)
        scores["method"] = method_score
        if method_score >= 0.8:
            reasons.append(
                f"Payment via '{method}' is a high-risk channel commonly used "
                "in scams because it is difficult to reverse or trace."
            )
        elif method_score >= 0.4:
            reasons.append(
                f"Payment via '{method}' carries moderate risk. "
                "Verify the recipient carefully before proceeding."
            )

        # --- Location mismatch ---
        user_loc = data.get("user_location", "")
        txn_loc = data.get("txn_location", "")
        loc_score = _location_risk(user_loc, txn_loc)
        scores["location"] = loc_score
        if loc_score >= 0.7:
            reasons.append(
                f"The transaction is being sent to a location "
                f"({txn_loc or 'unknown'}) different from your usual area "
                f"({user_loc or 'unknown'}). Geographic mismatches are a "
                "common sign of account takeover or fraud."
            )

        # --- Transaction frequency ---
        freq = int(data.get("txn_count_last_hour", 0))
        freq_score = _frequency_risk(freq)
        scores["frequency"] = freq_score
        if freq_score >= 0.6:
            reasons.append(
                f"You have made {freq} transactions in the last hour. "
                "Unusually high transaction frequency is a strong indicator "
                "of automated fraud or account compromise."
            )

        # --- Suspicious recipient ---
        recipient = data.get("recipient", "").strip().lower()
        recipient_score = 0.0
        if recipient in ("unknown", "anonymous", ""):
            recipient_score = 0.5
            reasons.append(
                "The recipient identity is unknown or not provided. "
                "Always verify the beneficiary before transferring money."
            )

        # --- Weighted composite score ---
        raw = sum(self.WEIGHTS[k] * scores[k] for k in self.WEIGHTS)
        raw = min(raw + recipient_score * 0.1, 1.0)
        risk_score = round(raw * 100)

        # --- Classification ---
        if risk_score < 30:
            label = "Safe"
            color = "success"
        elif risk_score < 65:
            label = "Suspicious"
            color = "warning"
        else:
            label = "High Risk"
            color = "danger"

        # --- Tips ---
        if label in ("Suspicious", "High Risk"):
            tips.append("Never share your OTP, PIN, or password with anyone, including bank officials.")
            tips.append("Call your bank immediately on the official helpline if you suspect fraud.")
            tips.append("Verify the recipient's details through an independent, trusted channel before sending money.")
        if method_score >= 0.8:
            tips.append(f"Be extra cautious with {method} payments — they are generally irreversible.")
        if hour_score >= 0.5:
            tips.append("If you did not initiate this transaction, block your account/card immediately.")
        if loc_score >= 0.7:
            tips.append("Check if your device or account has been accessed from an unknown location.")
        if not tips:
            tips.append("This transaction appears normal. Always stay alert and review your bank statements regularly.")
            tips.append("Enable transaction alerts on your bank account for real-time monitoring.")

        if not reasons:
            reasons.append("No significant risk factors were detected in this transaction.")

        return {
            "risk_score": risk_score,
            "label": label,
            "color": color,
            "reasons": reasons,
            "tips": tips,
            "feature_scores": {
                "Amount Risk":    round(scores["amount"] * 100),
                "Time Risk":      round(scores["hour"] * 100),
                "Payment Risk":   round(scores["method"] * 100),
                "Location Risk":  round(scores["location"] * 100),
                "Frequency Risk": round(scores["frequency"] * 100),
            },
        }


# Singleton
_model = ScamRiskModel()


def analyze_transaction(data: dict) -> dict:
    return _model.predict(data)
