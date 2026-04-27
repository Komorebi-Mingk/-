from statistics import mean


def analyze_metrics(metrics: list[dict]) -> dict:
    if not metrics:
        return {
            "avg_grip_intensity": 0,
            "avg_stability": 0,
            "fatigue_risk": "未知",
            "score": 0,
            "recommendation": "今天暂无有效数据，请重新完成训练。",
        }

    grip_values = [m.get("gripIntensity", 0) for m in metrics]
    stability_values = [m.get("stability", 0) for m in metrics]
    fatigue_values = [m.get("fatigueIndex", 0) for m in metrics]

    avg_grip = round(mean(grip_values), 2)
    avg_stability = round(mean(stability_values), 2)
    avg_fatigue = round(mean(fatigue_values), 2)

    score = round(avg_grip * 0.45 + avg_stability * 0.4 + max(0, 100 - avg_fatigue) * 0.15)

    if avg_fatigue > 70:
        fatigue_risk = "高"
    elif avg_fatigue > 45:
        fatigue_risk = "中"
    else:
        fatigue_risk = "低"

    if score >= 80 and fatigue_risk == "低":
        recommendation = "状态较好，明日训练强度可上调 10%。"
    elif fatigue_risk == "高":
        recommendation = "出现疲劳风险，建议降低节奏并延长组间休息。"
    elif avg_stability < 55:
        recommendation = "动作稳定性偏低，建议降低速度并关注手腕姿态。"
    else:
        recommendation = "维持当前计划，坚持每日训练并观察 3 天趋势。"

    return {
        "avg_grip_intensity": avg_grip,
        "avg_stability": avg_stability,
        "fatigue_risk": fatigue_risk,
        "score": score,
        "recommendation": recommendation,
    }
