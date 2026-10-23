const normalizeStatus = (value) => (value || '').toString().trim().toLowerCase();

const getComplaintStatusBucket = (value) => {
  const status = normalizeStatus(value);

  if (!status) {
    return 'pending';
  }

  if (status.includes('resolved') || status.includes('complete') || status.includes('completed')) {
    return 'resolved';
  }

  if (status.includes('escalat') || status.includes('urgent')) {
    return 'escalated';
  }

  if (
    status.includes('ongoing') ||
    status.includes('progress') ||
    status.includes('in progress') ||
    status.includes('in review') ||
    status.includes('review') ||
    status.includes('investigation') ||
    status.includes('assigned')
  ) {
    return 'inReview';
  }

  if (status.includes('pending') || status.includes('received') || status.includes('new')) {
    return 'pending';
  }

  return 'pending';
};

const statusMatchesTab = (statusValue, tabLabel) => {
  const bucket = getComplaintStatusBucket(statusValue);

  if (tabLabel === 'Pending') {
    return bucket === 'pending';
  }

  if (tabLabel === 'Ongoing') {
    return bucket === 'inReview';
  }

  if (tabLabel === 'Escalated') {
    return bucket === 'escalated';
  }

  if (tabLabel === 'Resolved') {
    return bucket === 'resolved';
  }

  return false;
};

module.exports = {
  normalizeStatus,
  getComplaintStatusBucket,
  statusMatchesTab,
};
