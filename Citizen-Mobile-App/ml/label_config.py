from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DepartmentInfo:
    department_id: str
    department_name: str


CATEGORY_TRAFFIC = "traffic issues"
CATEGORY_NUISANCE = "Public Nuisance / Cleanliness"
CATEGORY_NEIGHBOR = "Neighbor / Community Issues"

# Canonical label order is used in metrics, confusion matrix, and model outputs.
CATEGORY_ORDER = [
    CATEGORY_TRAFFIC,
    CATEGORY_NUISANCE,
    CATEGORY_NEIGHBOR,
]

LABEL_ALIASES = {
    "traffic issues": CATEGORY_TRAFFIC,
    "traffic issue": CATEGORY_TRAFFIC,
    "trafficissues": CATEGORY_TRAFFIC,
    "traffic issues complaints": CATEGORY_TRAFFIC,
    "traffic": CATEGORY_TRAFFIC,
    "Traffic Issues": CATEGORY_TRAFFIC,
    "Traffic Issue": CATEGORY_TRAFFIC,
    "Public Nuisance / Cleanliness": CATEGORY_NUISANCE,
    "public nuisance / cleanliness": CATEGORY_NUISANCE,
    "Public Nuisance/Cleanliness": CATEGORY_NUISANCE,
    "Neighbor / Community Issues": CATEGORY_NEIGHBOR,
    "neighbor / community issues": CATEGORY_NEIGHBOR,
    "Neighbour / Community Issues": CATEGORY_NEIGHBOR,
}


DEPARTMENT_BY_CATEGORY = {
    CATEGORY_TRAFFIC: DepartmentInfo(
        department_id="traffic-division",
        department_name="Traffic Division",
    ),
    CATEGORY_NUISANCE: DepartmentInfo(
        department_id="minor-offences-branch",
        department_name="Minor Offences Branch",
    ),
    CATEGORY_NEIGHBOR: DepartmentInfo(
        department_id="community-policing-unit",
        department_name="Community Policing Unit",
    ),
}


def normalize_label(raw_label: str) -> str:
    if raw_label is None:
        raise ValueError("Category is missing")

    compact = " ".join(str(raw_label).strip().split())
    if compact in LABEL_ALIASES:
        return LABEL_ALIASES[compact]

    lowered = compact.lower()
    if lowered in LABEL_ALIASES:
        return LABEL_ALIASES[lowered]

    raise ValueError(f"Unknown category label: {raw_label!r}")


def department_for_category(category: str) -> DepartmentInfo:
    return DEPARTMENT_BY_CATEGORY[category]
