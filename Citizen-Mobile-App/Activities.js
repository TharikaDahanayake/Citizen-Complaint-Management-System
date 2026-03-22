import { StyleSheet, Text, View } from 'react-native';

export default function Activities() {
  return (
    <View style={styles.page}>
      <Text style={styles.heading}>Activities</Text>
      <Text style={styles.bodyText}>Your recent complaint and account activities will appear here.</Text>
      <Text style={styles.bodyText}>No activities to show yet.</Text>
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
    marginBottom: 12,
  },
  bodyText: {
    fontSize: 15,
    color: '#334155',
    marginBottom: 8,
  },
});
