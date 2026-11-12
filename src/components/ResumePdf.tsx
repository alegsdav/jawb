import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Resume } from "@/lib/types";
import { isInlineItem } from "@/lib/resume";

// Harvard single-column layout, matching the on-screen document. Text-based so ATS parsers read it.
const s = StyleSheet.create({
  page: { paddingVertical: 43, paddingHorizontal: 43, fontSize: 11, fontFamily: "Times-Roman", lineHeight: 1.25 },
  name: { fontSize: 16.5, fontFamily: "Times-Bold", textAlign: "center" },
  contact: { fontSize: 10, textAlign: "center", marginTop: 2 },
  section: { marginTop: 9 },
  sectionTitle: {
    fontFamily: "Times-Bold", textTransform: "uppercase", letterSpacing: 0.4,
    borderBottomWidth: 0.75, borderBottomColor: "#000", paddingBottom: 1, marginBottom: 4,
  },
  item: { marginBottom: 4.5 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontFamily: "Times-Italic" },
  bulletRow: { flexDirection: "row", paddingLeft: 8, marginTop: 1 },
  dot: { width: 10 },
  bulletText: { flex: 1 },
});

export function ResumePdf({ resume }: { resume: Resume }) {
  return (
    <Document title={`${resume.header.name} Resume`} author={resume.header.name}>
      <Page size="LETTER" style={s.page}>
        <Text style={s.name}>{resume.header.name}</Text>
        {resume.header.contact ? <Text style={s.contact}>{resume.header.contact}</Text> : null}
        {resume.sections.map((sec) => (
          <View key={sec.id} style={s.section}>
            <Text style={s.sectionTitle}>{sec.title}</Text>
            {sec.items.map((it) => {
              if (isInlineItem(it)) {
                return it.subtitle ? (
                  <Text key={it.id} style={s.item}>
                    <Text style={s.bold}>{it.title}: </Text>
                    {it.subtitle}
                  </Text>
                ) : (
                  <Text key={it.id} style={s.item}>{it.title}</Text>
                );
              }
              const bullets = it.bullets.filter((b) => b.text.trim());
              return (
                <View key={it.id} style={s.item} wrap={false}>
                  <View style={s.row}>
                    <Text style={s.bold}>{it.title}</Text>
                    <Text>{it.location}</Text>
                  </View>
                  {(it.subtitle || it.dates) && (
                    <View style={s.row}>
                      <Text style={s.italic}>{it.subtitle}</Text>
                      <Text>{it.dates}</Text>
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
