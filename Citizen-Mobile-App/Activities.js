import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { generateAnonOwnerHash } from './anonTracking';
import { db } from './firebaseConfig';
import { normalizeStatus, statusMatchesTab } from './statusUtils';

const formatTrackID = (value) => {
  if (value === null || value === undefined) {
    return 'Not Assigned';
  }

  const normalized = value.toString().trim();
  if (!normalized) {
    return 'Not Assigned';
  }

  if (/^\d+$/.test(normalized)) {
    return normalized.padStart(8, '0').slice(-8);
  }

  return normalized;
};

const buildLocationUrl = (complaint) => {
  const latitude = complaint?.latitude;
  const longitude = complaint?.longitude;
  const locationText = (complaint?.incidentLocation || '').toString().trim();

  if (typeof latitude === 'number' && typeof longitude === 'number') {
    return `https://maps.google.com/?q=${latitude},${longitude}`;
  }

  if (locationText.startsWith('http://') || locationText.startsWith('https://')) {
    return locationText;
  }

  if (locationText) {
    return `https://maps.google.com/?q=${encodeURIComponent(locationText)}`;
  }

  return '';
};

const buildOfficerMap = (officerDocuments) => {
  const map = new Map();

  officerDocuments.forEach((documentSnapshot) => {
    const data = documentSnapshot.data() || {};
    const officerStationId = (data.stationID || data.stationId || '').toString().trim();
    const idCandidates = [
      documentSnapshot.id,
      data.officerID,
      data.officerId,
      data.id,
    ]
      .filter(Boolean)
      .map((value) => value.toString().trim());

    idCandidates.forEach((id) => {
      const existing = map.get(id) || [];
      existing.push({
        officerID: id,
        stationID: officerStationId,
        officerName: data.officerName || data.name || data.fullName || 'Unassigned',
        officerContact: data.officerContact || data.contact || data.phone || 'N/A',
      });
      map.set(id, existing);
    });
  });

  return map;
};

const toMillis = (value) => {
  if (!value) {
    return 0;
  }

  if (typeof value?.toMillis === 'function') {
    return value.toMillis();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (
    typeof value === 'object' &&
    Number.isFinite(value.seconds) &&
    Number.isFinite(value.nanoseconds)
  ) {
    return (value.seconds * 1000) + Math.floor(value.nanoseconds / 1000000);
  }

  return 0;
};

const findOfficerByIdAndStation = (officerMap, officerID, stationID) => {
  if (!officerID) {
    return null;
  }

  const matches = officerMap.get(officerID) || [];
  if (matches.length === 0) {
    return null;
  }

  if (stationID) {
    const exactStationMatch = matches.find((officer) => officer.stationID === stationID);
    if (exactStationMatch) {
      return exactStationMatch;
    }

    // If complaint has a station, do not assign officer from a different station.
    return null;
  }

  return matches[0];
};

const DetailRow = ({ label, value }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value || 'N/A'}</Text>
  </View>
);

export default function Activities({ citizen }) {
  const tabs = useMemo(() => ['Pending', 'Ongoing', 'Escalated', 'Resolved'], []);
  const [activeTab, setActiveTab] = useState('Pending');
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState('');

  const citizenId = useMemo(
    () => citizen?.citizenUid || citizen?.citizenID || '',
    [citizen]
  );

  useEffect(() => {
    const loadComplaints = async () => {
      if (!citizenId) {
        setComplaints([]);
        return;
      }

      setLoading(true);

      try {
        const anonOwnerHash = await generateAnonOwnerHash(citizenId);

        const nonAnonymousComplaintsQuery = query(
          collection(db, 'complaints'),
          where('citizenID', '==', citizenId)
        );
        const anonymousComplaintsQuery = query(
          collection(db, 'complaints'),
          where('anonOwnerHash', '==', anonOwnerHash)
        );

        const [nonAnonymousSnapshot, anonymousSnapshot, officersSnapshot] = await Promise.all([
          getDocs(nonAnonymousComplaintsQuery),
          getDocs(anonymousComplaintsQuery),
          getDocs(collection(db, 'officers')),
        ]);

        const complaintMap = new Map();
        nonAnonymousSnapshot.docs.forEach((documentSnapshot) => {
          complaintMap.set(documentSnapshot.id, documentSnapshot);
        });
        anonymousSnapshot.docs.forEach((documentSnapshot) => {
          complaintMap.set(documentSnapshot.id, documentSnapshot);
        });

        const officerMap = buildOfficerMap(officersSnapshot.docs);

        const nextComplaints = Array.from(complaintMap.values()).map((documentSnapshot) => {
          const data = documentSnapshot.data() || {};
          const complaintOfficerId = (data.officerID || '').toString().trim();
          const complaintStationId = (data.stationID || data.stationId || '').toString().trim();
          const matchedOfficer = findOfficerByIdAndStation(
            officerMap,
            complaintOfficerId,
            complaintStationId
          );

          const createdAtMs = toMillis(data.createdAt);
          const updatedAtMs = toMillis(data.updatedAt);

          return {
            id: documentSnapshot.id,
            trackID: formatTrackID(data.trackID),
            title: data.title || 'Untitled Complaint',
            description: data.description || 'No description provided.',
            complaintCategory: data.complaintCategory || data.category || 'Unknown',
            incidentLocation: data.incidentLocation || '',
            locationUrl: buildLocationUrl(data),
            evidenceUrls: Array.isArray(data.evidenceUrls)
              ? data.evidenceUrls.filter((url) => typeof url === 'string' && url.trim())
              : [],
            status: data.status || data.complaintStatus || 'Pending',
            comment: data.comment || '',
            feedback: data.feedback || '',
            stationID: complaintStationId || 'N/A',
            stationName: data.stationName || 'N/A',
            department: data.department || 'N/A',
            officerName: matchedOfficer?.officerName || 'Unassigned',
            officerContact: matchedOfficer?.officerContact || 'N/A',
            officerID: complaintOfficerId || 'N/A',
            createdAtMs,
            updatedAtMs,
          };
        });

        nextComplaints.sort((a, b) => {
          const bTime = b.createdAtMs || b.updatedAtMs || 0;
          const aTime = a.createdAtMs || a.updatedAtMs || 0;
          return bTime - aTime;
        });

        setComplaints(nextComplaints);
      } catch (error) {
        console.error('Unable to load complaints for activities:', error);
        setComplaints([]);
      } finally {
        setLoading(false);
      }
    };

    loadComplaints();
  }, [citizenId]);

  const filteredComplaints = useMemo(
    () => complaints.filter((complaint) => statusMatchesTab(complaint.status, activeTab)),
    [activeTab, complaints]
  );

  const openExternalLink = async (url) => {
    if (!url) {
      return;
    }

    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    }
  };

  const openComplaintDetails = (complaint) => {
    setSelectedComplaint(complaint);
    setFeedbackText(complaint.feedback || '');
    setFeedbackNotice('');
  };

  const closeComplaintDetails = () => {
    setSelectedComplaint(null);
    setFeedbackText('');
    setFeedbackNotice('');
  };

  const submitFeedback = async () => {
    if (!selectedComplaint || normalizeStatus(selectedComplaint.status) !== 'resolved') {
      return;
    }

    const trimmedFeedback = feedbackText.trim();
    if (!trimmedFeedback) {
      return;
    }

    setSavingFeedback(true);

    try {
      await updateDoc(doc(db, 'complaints', selectedComplaint.id), {
        feedback: trimmedFeedback,
        feedbackAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSelectedComplaint((previousComplaint) => ({
        ...previousComplaint,
        feedback: trimmedFeedback,
      }));

      setFeedbackText(trimmedFeedback);
      setFeedbackNotice('Feedback submitted successfully.');

      setComplaints((previousComplaints) => (
        previousComplaints.map((complaint) => (
          complaint.id === selectedComplaint.id
            ? { ...complaint, feedback: trimmedFeedback }
            : complaint
        ))
      ));
    } catch (error) {
      console.error('Unable to save feedback:', error);
    } finally {
      setSavingFeedback(false);
    }
  };

  const tabMessages = {
    Pending: 'Pending complaints will appear here.',
    Ongoing: 'Ongoing complaints that are in progress will appear here.',
    Escalated: 'Escalated complaints will appear here.',
    Resolved: 'Resolved complaints will appear here.',
  };

  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Activities</Text>

      {selectedComplaint ? (
        <View style={styles.detailPage}>
          <Pressable style={styles.backButton} onPress={closeComplaintDetails}>
            <Ionicons name="arrow-back" size={18} color="#1d4ed8" />
            <Text style={styles.backButtonText}>Back to Activities</Text>
          </Pressable>

          <View style={styles.detailHeaderCard}>
            
            <Text style={styles.detailPageTitle}>{selectedComplaint.title}</Text>
            <View style={styles.headerMetaRow}>
              <View style={styles.trackIdBadge}>
                <Text style={styles.trackIdBadgeText}>Track ID: {selectedComplaint.trackID}</Text>
              </View>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryBadgeText}>{selectedComplaint.complaintCategory}</Text>
              </View>
            </View>
          </View>

          <View style={styles.detailSectionCard}>
            <View style={styles.detailSectionHeading}>
              <View style={styles.sectionIcon}><Ionicons name="document-text-outline" size={19} color="#1d4ed8" /></View>
              <View>
                <Text style={styles.detailSectionTitle}>Complaint </Text>
                
              </View>
            </View>
            <Text style={styles.descriptionText}>{selectedComplaint.description}</Text>
            <View style={styles.locationRow}>
              <View style={styles.locationIcon}><Ionicons name="location-outline" size={19} color="#1d4ed8" /></View>
              {selectedComplaint.locationUrl ? (
                <Pressable style={styles.mapButton} onPress={() => openExternalLink(selectedComplaint.locationUrl)}>
                  <Text style={styles.mapButtonText}>View on Map</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={styles.detailSectionCard}>
            <View style={styles.detailSectionHeading}>
              <View style={styles.sectionIcon}><Ionicons name="shield-checkmark-outline" size={19} color="#1d4ed8" /></View>
              <View>
                <Text style={styles.detailSectionTitle}>Complaint Assignment</Text>
                
              </View>
            </View>
            <View style={styles.assignmentGrid}>
              <DetailRow label="Police station" value={selectedComplaint.stationName} />
              <DetailRow label="Department" value={selectedComplaint.department} />
              <DetailRow label="Officer name" value={selectedComplaint.officerName} />
              <DetailRow label="Contact no" value={selectedComplaint.officerContact} />
            </View>
          </View>

          <View style={styles.detailSectionCard}>
            <View style={styles.detailSectionHeading}>
              <View style={styles.sectionIcon}><Ionicons name="checkmark-circle-outline" size={19} color="#15803d" /></View>
              <View>
                <Text style={styles.detailSectionTitle}>Resolution</Text>
                
              </View>
            </View>
            <View style={styles.resolutionBox}>
              <Text style={styles.resolutionText}>{selectedComplaint.comment || 'No resolution or action has been recorded yet.'}</Text>
            </View>
          </View>

          <View style={styles.detailSectionCard}>
            <View style={styles.detailSectionHeading}>
              <View style={styles.sectionIcon}><Ionicons name="attach-outline" size={20} color="#1d4ed8" /></View>
              <View>
                <Text style={styles.detailSectionTitle}>Evidence & Attachments</Text>
                
              </View>
            </View>
            {selectedComplaint.evidenceUrls.length > 0 ? (
              selectedComplaint.evidenceUrls.map((url, index) => (
                <Pressable
                  key={`${selectedComplaint.id}-evidence-${index}`}
                  style={styles.evidenceLink}
                  onPress={() => openExternalLink(url)}
                >
                  <Ionicons name="document-attach-outline" size={18} color="#1d4ed8" />
                  <Text style={styles.evidenceLinkText}>Open attachment {index + 1}</Text>
                  <Ionicons name="open-outline" size={16} color="#64748b" />
                </Pressable>
              ))
            ) : (
              <Text style={styles.emptyText}>No evidence attached.</Text>
            )}
          </View>

          {normalizeStatus(selectedComplaint.status) === 'resolved' ? (
            <View style={styles.feedbackSection}>
              <View style={styles.detailSectionHeading}>
                <View style={styles.sectionIcon}><Ionicons name="chatbubble-ellipses-outline" size={19} color="#1d4ed8" /></View>
                <View>
                  <Text style={styles.detailSectionTitle}>Feedback</Text>
                  
                </View>
              </View>
              {selectedComplaint.feedback ? (
                <View style={styles.feedbackSavedBox}>
                  <Text style={styles.feedbackSavedText}>{selectedComplaint.feedback}</Text>
                </View>
              ) : (
                <>
                  <TextInput
                    style={styles.feedbackInput}
                    value={feedbackText}
                    onChangeText={setFeedbackText}
                    placeholder="Share your feedback about the resolution"
                    placeholderTextColor="#94a3b8"
                    multiline
                    textAlignVertical="top"
                  />
                  <Pressable
                    style={[styles.feedbackButton, savingFeedback && styles.feedbackButtonDisabled]}
                    onPress={submitFeedback}
                    disabled={savingFeedback}
                  >
                    <Ionicons name="send-outline" size={17} color="#ffffff" />
                    <Text style={styles.feedbackButtonText}>
                      {savingFeedback ? 'Saving...' : 'Submit Feedback'}
                    </Text>
                  </Pressable>
                </>
              )}
              {feedbackNotice ? <Text style={styles.feedbackSuccessText}>{feedbackNotice}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {!selectedComplaint ? (
        <>
          <View style={styles.tabBar}>
            {tabs.map((tab) => {
              const isActive = tab === activeTab;
              return (
                <Pressable
                  key={tab}
                  style={[styles.tabButton, isActive && styles.activeTabButton]}
                  onPress={() => setActiveTab(tab)}
                >
                  <Text style={[styles.tabText, isActive && styles.activeTabText]}>{tab}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.subPageCard}>
            <View style={styles.subPageHeader}>
              <View>
                <Text style={styles.subPageTitle}>{activeTab} Complaints</Text>
                
              </View>
            </View>

            {loading ? <Text style={styles.bodyText}>Loading complaints...</Text> : null}

            {!loading && filteredComplaints.length === 0 ? (
              <Text style={styles.bodyText}>{tabMessages[activeTab]}</Text>
            ) : null}

            {!loading
              ? filteredComplaints.map((complaint) => (
                  <View key={complaint.id} style={styles.complaintBox}>
                    <View style={styles.complaintHeader}>
                      <View style={styles.complaintHeaderText}>
                        <Text style={styles.complaintTitle}>{complaint.title}</Text>
                        <View style={styles.trackIdBadge}>
                          <Text style={styles.trackIdBadgeText}>Track ID: {complaint.trackID}</Text>
                        </View>
                      </View>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>{complaint.status}</Text>
                      </View>
                    </View>

                    <Text style={styles.complaintPreview} numberOfLines={2}>
                      {complaint.description}
                    </Text>

                    <View style={styles.complaintFooter}>
                      <View style={styles.categoryPill}>
                        <Text style={styles.categoryPillText}>{complaint.complaintCategory}</Text>
                      </View>

                      <Pressable style={styles.detailsButton} onPress={() => openComplaintDetails(complaint)}>
                        <Text style={styles.detailsButtonText}>Details</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              : null}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 20,
    paddingBottom: 28,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    padding: 4,
    marginBottom: 14,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingVertical: 9,
  },
  activeTabButton: {
    backgroundColor: '#1E3A8A',
  },
  tabText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  activeTabText: {
    color: '#f8fafc',
  },
  subPageCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
  },
  subPageHeader: {
    marginBottom: 8,
  },
  subPageTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  subPageSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
  bodyText: {
    fontSize: 15,
    color: '#334155',
    marginBottom: 8,
  },
  detailPageCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
    marginBottom: 14,
  },
  detailPage: {
    gap: 12,
    paddingBottom: 12,
  },
  detailHeaderCard: {
    backgroundColor: '#1e3a8a',
    borderRadius: 18,
    padding: 20,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  detailEyebrow: {
    color: '#bfdbfe',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  headerMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  detailSectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    shadowColor: '#0f172a',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  detailSectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
  },
  detailSectionTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  detailSectionSubtitle: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  backButtonText: {
    color: '#1d4ed8',
    fontSize: 14,
    fontWeight: '700',
  },
  detailPageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 4,
    lineHeight: 31,
  },
  detailPageSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 12,
  },
  feedbackSection: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  feedbackLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  feedbackInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 10,
  },
  feedbackButton: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1E3A8A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  feedbackButtonDisabled: {
    opacity: 0.7,
  },
  feedbackButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  feedbackSavedBox: {
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  feedbackSavedText: {
    fontSize: 14,
    color: '#166534',
    lineHeight: 20,
  },
  feedbackSuccessText: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#15803d',
  },
  categoryBadge: {
    backgroundColor: '#fef3c7',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  categoryBadgeText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '700',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#ffffff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16a34a',
  },
  statusBadgeText: {
    color: '#1e3a8a',
    fontSize: 13,
    fontWeight: '800',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    marginTop: 16,
    paddingTop: 14,
  },
  locationIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
  },
  locationTextWrap: {
    flex: 1,
  },
  mapButton: {
    marginLeft: 'auto',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  mapButtonText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '800',
  },
  assignmentGrid: {
    gap: 12,
  },
  resolutionBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    padding: 13,
  },
  resolutionText: {
    color: '#166534',
    fontSize: 14,
    lineHeight: 21,
  },
  evidenceLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  evidenceLinkText: {
    flex: 1,
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: '700',
  },
  complaintBox: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
    backgroundColor: '#ffffff',
  },
  complaintHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  complaintHeaderText: {
    flex: 1,
  },
  complaintTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  complaintMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  trackIdBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 6,
  },
  trackIdBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1d4ed8',
  },
 
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  primaryBadge: {
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  primaryBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  secondaryBadge: {
    backgroundColor: '#fef9c3',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  secondaryBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#854d0e',
  },
  complaintPreview: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 6,
  },
  sectionTitleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
    marginTop: 6,
  },
  descriptionBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
  },
  descriptionText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
  },
  actionLink: {
    alignSelf: 'flex-start',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#93c5fd', 
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  actionLinkText: {
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  detailLabel: {
    width: 112,
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  detailValue: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    lineHeight: 18,
  },
  complaintFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
  statusPill: {
    backgroundColor: '#e2e8f0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  categoryPill: {
    backgroundColor: '#fef9c3',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flex: 1,
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#854d0e',
  },
  detailsButton: {
    backgroundColor: '#1E3A8A',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  detailsButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
