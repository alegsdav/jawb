import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Item, Resume, TextStyle } from "@/lib/types";
import { isInlineItem } from "@/lib/resume";
import { effectiveStyle, type StyleField } from "@/lib/textStyle";

// Harvard single-column layout, matching the on-screen document. Text-based so ATS parsers read it.
const s = StyleSheet.create({
  page: { paddingVertical: 43, paddingHorizontal: 43, fontSize: 11, fontFamily: "Times-Roman", lineHeight: 1.25 },
  name: { fontSize: 16.5, textAlign: "center" },
  contact: { fontSize: 10, textAlign: "center", marginTop: 2 },
  section: { marginTop: 9 },
  sectionTitle: {
    textTransform: "uppercase", letterSpacing: 0.4,
    borderBottomWidth: 0.75, borderBottomColor: "#000", paddingBottom: 1, marginBottom: 4,
  },
  item: { marginBottom: 4.5 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bulletRow: { flexDirection: "row", paddingLeft: 8, marginTop: 1 },
  dot: { width: 10 },
  bulletText: { flex: 1 },
});

/** The built-in Times face for a bold/italic pair. */
function fontFor(bold: boolean, italic: boolean): string {
  if (bold) return italic ? "Times-BoldItalic" : "Times-Bold";
  return italic ? "Times-Italic" : "Times-Roman";
}

/** Font style for one field: its effective bold/italic (override or Harvard default). */
function fieldFont(field: StyleField, override: TextStyle | undefined, item?: Item) {
  const { bold, italic } = effectiveStyle(field, override, item);
  return { fontFamily: fontFor(bold, italic) };
}

export function ResumePdf({ resume }: { resume: Resume }) {
  const styles = resume.header.styles;
  return (
    <Document title={`${resume.header.name} Resume`} author={resume.header.name}>
      <Page size="LETTER" style={s.page}>
        <Text style={[s.name, fieldFont("name", styles?.name)]}>{resume.header.name}</Text>
        {resume.header.contact ? (
          <Text style={[s.contact, fieldFont("contact", styles?.contact)]}>{resume.header.contact}</Text>
        ) : null}
        {resume.sections.map((sec) => (
          <View key={sec.id} style={s.section}>
            <Text style={[s.sectionTitle, fieldFont("sectionTitle", sec.style)]}>{sec.title}</Text>
            {sec.items.map((it) => {
              const title = fieldFont("title", it.styles?.title, it);
              const subtitle = fieldFont("subtitle", it.styles?.subtitle, it);
              if (isInlineItem(it)) {
                return it.subtitle ? (
                  <Text key={it.id} style={s.item}>
                    <Text style={title}>{it.title}: </Text>
                    <Text style={subtitle}>{it.subtitle}</Text>
                  </Text>
                ) : (
                  <Text key={it.id} style={[s.item, title]}>{it.title}</Text>
                );
              }
              const bullets = it.bullets.filter((b) => b.text.trim());
              return (
                <View key={it.id} style={s.item} wrap={false}>
                  <View style={s.row}>
                    <Text style={title}>{it.title}</Text>
                    <Text style={fieldFont("location", it.styles?.location, it)}>{it.location}</Text>
                  </View>
                  {(it.subtitle || it.dates) && (
                    <View style={s.row}>
                      <Text style={subtitle}>{it.subtitle}</Text>
                      <Text style={fieldFont("dates", it.styles?.dates, it)}>{it.dates}</Text>
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
