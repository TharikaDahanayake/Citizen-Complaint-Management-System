const DEFAULT_PREDICTION_URL = 'http://10.0.2.2:8000/predict';

const CATEGORY_TRAFFIC = 'traffic issues';
const CATEGORY_NUISANCE = 'Public Nuisance / Cleanliness';
const CATEGORY_NEIGHBOR = 'Neighbor / Community Issues';

const CATEGORY_TO_DEPARTMENT = {
  [CATEGORY_TRAFFIC]: {
    departmentID: 'traffic-division',
    department: 'Traffic Division',
  },
  [CATEGORY_NUISANCE]: {
    departmentID: 'minor-offences-branch',
    department: 'Minor Offences Branch',
  },
  [CATEGORY_NEIGHBOR]: {
    departmentID: 'community-policing-unit',
    department: 'Community Policing Unit',
  },
};

const KEYWORD_RULES = {
  [CATEGORY_TRAFFIC]: [
    'traffic', 'signal', 'parking', 'vehicle', 'driver', 'road', 'accident', 'bus', 'truck', 'car', 'motorbike',
  ],
  [CATEGORY_NUISANCE]: [
    'garbage', 'trash', 'waste', 'clean', 'dirty', 'smell', 'litter', 'dump', 'pollution',
  ],
  [CATEGORY_NEIGHBOR]: [
    'neighbor', 'neighbour', 'community', 'noise', 'loud', 'party', 'dispute', 'disturbance', 'harassment',
  ],
};

const normalizeText = (value) => (value || '').toLowerCase().trim();

const mapDepartment = (category) => {
  return CATEGORY_TO_DEPARTMENT[category] || {
    departmentID: null,
    department: null,
  };
};

const keywordFallback = (description) => {
  const text = normalizeText(description);
  const scores = Object.keys(CATEGORY_TO_DEPARTMENT).map((category) => {
    const keywords = KEYWORD_RULES[category] || [];
    const score = keywords.reduce((sum, keyword) => sum + (text.includes(keyword) ? 1 : 0), 0);
    return { category, score };
  });

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0]?.category || CATEGORY_NEIGHBOR;
  const { departmentID, department } = mapDepartment(best);

  return {
    complaintCategory: best,
    departmentID,
    department,
    aiConfidence: 0.35,
    aiSource: 'mobile-keyword-fallback',
    aiReviewRequired: true,
  };
};

export const categorizeComplaint = async (description) => {
  const trimmed = (description || '').trim();
  if (!trimmed) {
    throw new Error('Complaint description is required for categorization.');
  }

  const predictionUrl = process.env.EXPO_PUBLIC_COMPLAINT_AI_API_URL || DEFAULT_PREDICTION_URL;

  try {
    const response = await fetch(predictionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description: trimmed }),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`Prediction API error ${response.status}: ${bodyText}`);
    }

    const data = await response.json();
    const category = data?.complaintCategory;

    if (!category || !CATEGORY_TO_DEPARTMENT[category]) {
      throw new Error('Prediction API returned invalid category.');
    }

    const { departmentID, department } = mapDepartment(category);

    return {
      complaintCategory: category,
      departmentID,
      department,
      aiConfidence: Number(data?.confidence || 0),
      aiSource: 'trained-model-api',
      aiReviewRequired: Boolean(data?.reviewRequired),
      aiThreshold: Number(data?.threshold || 0),
      aiModelVersion: data?.modelVersion || null,
    };
  } catch (error) {
    console.warn('Prediction API unavailable; using keyword fallback.', error?.message || error);
    return keywordFallback(trimmed);
  }
};
