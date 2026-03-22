import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function ComplaintSubmission({ onAnonymousPress, onNonAnonymousPress, onBackToHome }) {
  return (
    <View style={styles.page}>
      <Text style={styles.heading}>Complaint Submission</Text>
      <Text style={styles.subtitle}>Choose how you want to submit your complaint.</Text>

      <TouchableOpacity style={styles.button} onPress={onAnonymousPress} activeOpacity={0.8}>
        <Text style={styles.buttonText}>Anonymous Complaint Submission</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.button} onPress={onNonAnonymousPress} activeOpacity={0.8}>
        <Text style={styles.buttonText}>Non-Anonymous Complaint Submission</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.backButton} onPress={onBackToHome} activeOpacity={0.8}>
        <Text style={styles.backButtonText}>Back to Home</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    padding: 20,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#475569',
    marginBottom: 20,
  },
  button: {
    height: 54,
    borderRadius: 10,
    backgroundColor: '#737000',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  backButton: {
    marginTop: 10,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#737000',
    fontSize: 14,
    fontWeight: '600',
  },
});
