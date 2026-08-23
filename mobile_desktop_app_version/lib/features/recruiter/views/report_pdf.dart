// lib/features/recruiter/views/report_pdf.dart
//
// Builds a shareable PDF of a scored interview report (Phase 5 polish).
// Uses the pure-Dart `pdf` package for layout and `printing` to share/print;
// both are cross-platform (iOS + Android), so this never affects the shared
// Android build beyond adding a standard plugin.

import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import 'package:talbotiq/features/recruiter/engine/conversation_engine.dart';
import 'package:talbotiq/features/recruiter/models/recruiter_models.dart';

class _Row {
  final String title;
  final String answer;
  final PerQuestionResult? pq;
  const _Row(this.title, this.answer, this.pq);
}

String _kpiLabel(InterviewTemplate? template, String kpiId) {
  if (template == null) return kpiId;
  for (final k in template.rubric.kpis) {
    if (k.id == kpiId) return k.label;
  }
  return kpiId;
}

/// Assemble a PDF document for a report. Works for both the timed-Q&A track
/// (rows from `session.questions`) and the conversational track (rows grouped
/// from the transcript).
Future<Uint8List> buildReportPdf({
  required InterviewSession session,
  required InterviewTemplate? template,
  required ResultReport report,
}) async {
  final doc = pw.Document();

  final isConversation = session.questions.isEmpty &&
      session.transcript != null &&
      session.transcript!.isNotEmpty;

  final rows = <_Row>[];
  if (isConversation) {
    final groups = primaryQuestionGroups(session.transcript ?? []);
    for (final g in groups) {
      PerQuestionResult? pq;
      for (final p in report.perQuestion) {
        if (p.questionId == 'q${g.index}') {
          pq = p;
          break;
        }
      }
      rows.add(_Row(g.question, g.answer, pq));
    }
  } else {
    for (final q in session.questions) {
      PerQuestionResult? pq;
      for (final p in report.perQuestion) {
        if (p.questionId == q.id) {
          pq = p;
          break;
        }
      }
      rows.add(_Row(q.text, q.answerText ?? '', pq));
    }
  }

  final enabledKpis = template?.rubric.kpis.where((k) => k.enabled).toList() ??
      const <KpiDefinition>[];
  final rec = report.recommendation != null
      ? Recommendation.label(report.recommendation!)
      : '—';

  final accent = PdfColor.fromInt(0xFF0D5C3A);

  doc.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(32),
      build: (context) => [
        pw.Header(
          level: 0,
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text(
                (template?.branding.companyName ?? 'Mimic').toUpperCase(),
                style: pw.TextStyle(
                    fontSize: 10, color: accent, letterSpacing: 1.5),
              ),
              pw.SizedBox(height: 4),
              pw.Text(
                session.candidateName.isEmpty
                    ? 'Candidate'
                    : session.candidateName,
                style:
                    pw.TextStyle(fontSize: 22, fontWeight: pw.FontWeight.bold),
              ),
              pw.Text(
                '${template?.name ?? ''} · ${TrackType.label(session.track)}',
                style: const pw.TextStyle(fontSize: 11, color: PdfColors.grey700),
              ),
            ],
          ),
        ),
        pw.SizedBox(height: 8),
        // Overall + recommendation
        pw.Container(
          padding: const pw.EdgeInsets.all(14),
          decoration: pw.BoxDecoration(
            color: PdfColors.grey100,
            borderRadius: pw.BorderRadius.circular(8),
          ),
          child: pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.center,
            children: [
              pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text('OVERALL FIT',
                      style: pw.TextStyle(
                          fontSize: 9,
                          color: accent,
                          fontWeight: pw.FontWeight.bold)),
                  pw.Text('${report.overallScore.round()} / 100',
                      style: pw.TextStyle(
                          fontSize: 26, fontWeight: pw.FontWeight.bold)),
                ],
              ),
              pw.SizedBox(width: 24),
              pw.Text('Recommendation: $rec',
                  style: pw.TextStyle(
                      fontSize: 13, fontWeight: pw.FontWeight.bold)),
            ],
          ),
        ),
        if (report.degraded == true) ...[
          pw.SizedBox(height: 8),
          pw.Text(
            'Heuristic scoring (no Gemini key). Scores reflect answer length only.',
            style: const pw.TextStyle(fontSize: 9, color: PdfColors.orange800),
          ),
        ],
        pw.SizedBox(height: 14),
        pw.Text('Summary',
            style: pw.TextStyle(fontSize: 14, fontWeight: pw.FontWeight.bold)),
        pw.SizedBox(height: 4),
        pw.Text(report.summary, style: const pw.TextStyle(fontSize: 11)),
        if ((report.strengths ?? []).isNotEmpty) ...[
          pw.SizedBox(height: 10),
          pw.Text('Strengths',
              style:
                  pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold)),
          ...report.strengths!.map((s) => pw.Bullet(text: s, style: const pw.TextStyle(fontSize: 10))),
        ],
        if ((report.improvements ?? []).isNotEmpty) ...[
          pw.SizedBox(height: 8),
          pw.Text('Areas to improve',
              style:
                  pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold)),
          ...report.improvements!.map((s) => pw.Bullet(text: s, style: const pw.TextStyle(fontSize: 10))),
        ],
        pw.SizedBox(height: 14),
        // KPI averages
        if (enabledKpis.isNotEmpty) ...[
          pw.Text('KPI scores',
              style:
                  pw.TextStyle(fontSize: 14, fontWeight: pw.FontWeight.bold)),
          pw.SizedBox(height: 6),
          pw.Table(
            border: pw.TableBorder.all(color: PdfColors.grey300, width: 0.5),
            columnWidths: const {
              0: pw.FlexColumnWidth(3),
              1: pw.FlexColumnWidth(1),
            },
            children: [
              for (final k in enabledKpis)
                pw.TableRow(children: [
                  pw.Padding(
                      padding: const pw.EdgeInsets.all(6),
                      child: pw.Text(k.label,
                          style: const pw.TextStyle(fontSize: 10))),
                  pw.Padding(
                      padding: const pw.EdgeInsets.all(6),
                      child: pw.Text(
                          '${(report.kpiAverages[k.id] ?? 0).round()}',
                          style: pw.TextStyle(
                              fontSize: 10, fontWeight: pw.FontWeight.bold))),
                ]),
            ],
          ),
        ],
        pw.SizedBox(height: 14),
        pw.Text(isConversation ? 'Conversation breakdown' : 'Per-question breakdown',
            style: pw.TextStyle(fontSize: 14, fontWeight: pw.FontWeight.bold)),
        pw.SizedBox(height: 6),
        for (int i = 0; i < rows.length; i++) _pdfQuestion(i, rows[i], template),
        pw.SizedBox(height: 16),
        pw.Text(
          'Generated ${report.generatedAt}',
          style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600),
        ),
      ],
    ),
  );

  return doc.save();
}

pw.Widget _pdfQuestion(int index, _Row row, InterviewTemplate? template) {
  final pq = row.pq;
  return pw.Container(
    margin: const pw.EdgeInsets.only(bottom: 10),
    padding: const pw.EdgeInsets.all(8),
    decoration: pw.BoxDecoration(
      border: pw.Border.all(color: PdfColors.grey300, width: 0.5),
      borderRadius: pw.BorderRadius.circular(6),
    ),
    child: pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Text('Q${index + 1}. ${row.title}',
            style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold)),
        pw.SizedBox(height: 4),
        pw.Text(
          row.answer.trim().isNotEmpty ? row.answer : '(no answer provided)',
          style: const pw.TextStyle(fontSize: 10, color: PdfColors.grey800),
        ),
        if (pq != null && pq.kpiScores.isNotEmpty) ...[
          pw.SizedBox(height: 4),
          pw.Wrap(
            spacing: 8,
            runSpacing: 2,
            children: pq.kpiScores.entries
                .map((e) => pw.Text(
                    '${_kpiLabel(template, e.key)}: ${e.value.round()}',
                    style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey700)))
                .toList(),
          ),
        ],
        if (pq != null && pq.feedback.isNotEmpty) ...[
          pw.SizedBox(height: 4),
          pw.Text(pq.feedback,
              style: pw.TextStyle(
                  fontSize: 9, fontStyle: pw.FontStyle.italic)),
        ],
      ],
    ),
  );
}
