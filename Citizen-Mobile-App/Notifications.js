import { StyleSheet, Text, View } from 'react-native';

export default function Notifications() {
  return (
    <View style={styles.page}>
      <Text style={styles.heading}>Notifications</Text>
      <Text style={styles.bodyText}>Notifications from police stations and complaint updates will appear here.</Text>
      <Text style={styles.bodyText}>No notifications yet.</Text>
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
