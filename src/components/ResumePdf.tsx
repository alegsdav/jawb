import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Resume } from "@/lib/types";

// Single-column, text-based layout so ATS parsers read it cleanly.
const s = StyleSheet.create({
  page: { paddingVertical: 32, paddingHorizontal: 40, fontSize: 10, fontFamily: "Helvetica", lineHeight: 1.3 },
  name: { fontSize: 18, fontFamily: "Helvetica-Bold", textAlign: "center" },
  contact: { fontSize: 9, textAlign: "center", marginTop: 2, marginBottom: 6 },
  section: { marginTop: 8 },
  sectionTitle: {
    fontSize: 10.5, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.6,
    borderBottomWidth: 0.75, borderBottomColor: "#000", paddingBottom: 1, marginBottom: 4,
  },
  item: { marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontFamily: "Helvetica-Bold" },
  italic: { fontFamily: "Helvetica-Oblique" },
  bulletRow: { flexDirection: "row", paddingLeft: 8, marginTop: 1 },
  dot: { width: 8 },
  bulletText: { flex: 1 },
});

export function ResumePdf({ resume }: { resume: Resume }) {
  return (
    <Document title={`${resume.header.name} Resume`} author={resume.header.name}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.name}>{resume.header.name}</Text>
        <Text style={s.contact}>{resume.header.contact}</Text>
        {resume.sections.map((sec) => (
          <View key={sec.id} style={s.section}>
            <Text style={s.sectionTitle}>{sec.title}</Text>
            {sec.items.map((it) => {
              const bullets = it.bullets.filter((b) => b.text.trim());
              const inline = !bullets.length && !it.dates && !it.location;
              if (inline) {
                return (
                  <Text key={it.id} style={s.item}>
                    <Text style={s.bold}>{it.title}{it.subtitle ? ": " : ""}</Text>
                    {it.subtitle}
                  </Text>
                );
              }
              return (
                <View key={it.id} style={s.item} wrap={false}>
                  <View style={s.row}>
                    <Text style={s.bold}>{it.title}</Text>
                    <Text>{it.dates}</Text>
                  </View>
                  {(it.subtitle || it.location) && (
                    <View style={s.row}>
                      <Text style={s.italic}>{it.subtitle}</Text>
                      <Text style={s.italic}>{it.location}</Text>
                    </View>
                  )}
                  {bullets.map((b) => (
                    <View key={b.id} style={s.bulletRow}>
                      <Text style={s.dot}>•</Text>
                      <Text style={s.bulletText}>{b.text}</Text>
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        ))}
      </Page>
    </Document>
  );
}
