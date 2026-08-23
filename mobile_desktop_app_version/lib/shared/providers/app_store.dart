// lib/providers/app_store.dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:talbotiq/core/theme/accent_palette.dart';
import 'package:talbotiq/shared/models/app_models.dart';

/// Stages of the post-interview processing pipeline (transcript → AI scoring
/// → handoff to the recruiter), surfaced to the candidate-facing "submitted"
/// screen ([_VideoPendingScreen] in candidate_video_shell.dart) so a stalled
/// or failed step is visible instead of an indefinite spinner.
enum InterviewProcessingStage {
  idle,
  fetchingTranscript,
  evaluating,
  sendingToRecruiter,
  complete,
  // Gemini scoring failed, but the raw transcript/responses still made it to
  // the recruiter (as an unscored draft they can regenerate) — a soft
  // failure, distinct from [failed], which means even that fallback couldn't
  // be saved.
  submittedWithoutScoring,
  failed,
}

/// Central app-wide [ChangeNotifier]: owns the session/avatar config, theme
/// mode, current route, and the per-interview metadata carried into scoring.
/// Widgets should `select`/`Consumer` on the specific field they need rather
/// than listening to the whole store.
///
/// It holds NO API credentials. Every vendor key lives in the backend
/// environment; the app reaches third-party services through
/// `BackendClient`/the AI proxy and never sees a key. There is deliberately no
/// setter, no persisted field and no cloud sync for one.
class AppStore extends ChangeNotifier {
  // SharedPreferences keys
  static const String _kStoreKey = 'talbotiq_store';

  // Theme Mode
  ThemeMode _themeMode = ThemeMode.dark;
  AppAccent _accent = AppAccent.peach;
  AppAccent _secondaryAccent = AppAccent.lavender;

  // Global desktop text scale (Settings → Preferences → Font Size). Applied
  // once, at the MaterialApp root (see main.dart), via MediaQuery's
  // textScaler — never read directly by individual widgets — so every
  // screen, dialog and dynamically created page inherits it automatically
  // instead of each one needing its own "if (fontSize == ...)" branch.
  double _desktopFontScale = 1.0;


  // Defaults
  String _defaultReplicaId = '';
  String _defaultPersonaId = '';

  // Persisted session configuration (edited in Settings, consumed by Setup at
  // launch). Holds everything except the per-session candidate name.
  DraftForm _sessionConfig = DraftForm.defaults();

  // Active Session
  TavusConversation? _currentConversation;
  List<String> _questions = [
    'Tell me about yourself and your background.',
    'Describe a challenging problem you solved recently.',
    'How do you handle pressure and tight deadlines?',
    'Where do you see yourself in 3 years?',
    'Do you have any questions for us?',
  ];
  int _currentQuestionIdx = 0;
  bool _interviewActive = false;

  // Saved Drafts
  List<Draft> _drafts = [];


  // Live Metrics
  int _confidence = 0;
  int _anxiety = 0;
  int _wpm = 0;
  int _fillers = 0;
  int _engagement = 0;

  // Recording preferences
  bool _storeLocalRecordings = false;

  List<int> _questionTimestamps = [];

  // Transcript logs
  List<TranscriptEntry> _sessionTranscript = [];
  bool _deepgramConnected = false;
  Future<void>? _loadFuture;

  // True once the initial load from prefs has finished. Until then, setters
  // fired during startup must NOT persist — otherwise a default value written
  // before the load completes would overwrite the user's saved data.
  bool _loaded = false;

  // Locally-recorded interview audio (native only). Captured during the call,
  // sent to Deepgram for transcription on the results page.
  List<int>? _recordingBytes;

  // Post-interview processing pipeline status, keyed to the conversation that
  // just ended. Unlike `recordingBytes` (native-only), this is set the moment
  // _endInterview navigates to /results regardless of platform, so it's what
  // actually gates whether ResultsPage should run the analysis pipeline for a
  // freshly-finished session vs. just restoring a cached result.
  String? _pendingAnalysisConvId;
  InterviewProcessingStage _processingStage = InterviewProcessingStage.idle;
  String? _processingError;

  // True while a self-serve PRACTICE run is active (launched from the Practice
  // tab with no assigned Interview). Stamped onto the finished
  // InterviewResult so Practice History can exclude recruiter-assigned runs.
  bool _activeInterviewIsPractice = false;

  // Wall-clock (epoch ms) moment the local .wav recording actually started
  // (set once RecordingService.start() succeeds). This is the true zero-point
  // of the recorded audio's timeline, distinct from _questionTimestamps[0]
  // (set moments earlier, before the interview page even mounts) — used to
  // align Deepgram's per-word offsets to the correct question when slicing
  // the transcript by question.
  int? _recordingStartTimestamp;

  // Persisted interview recordings (kept on device when storeLocalRecordings is
  // enabled). Managed from Settings.
  List<SavedRecording> _recordings = [];

  // Persisted interview results history (full scorecard + transcript + emotion).
  List<InterviewResult> _interviewResults = [];

  // Routing state
  String _currentRoute = '/setup';
  String get currentRoute => _currentRoute;

  void navigateTo(String route) {
    _currentRoute = route;
    notifyListeners();
  }

  // Getters
  ThemeMode get themeMode => _themeMode;

  /// The primary block colour: the featured card, the primary button, the
  /// selected chip. See AppAccent for why recolouring these is safe.
  AppAccent get accent => _accent;

  /// The secondary block colour, for the supporting accents — chart bars,
  /// meters, the trend line. Kept separate so a user can set a two-colour
  /// scheme rather than having everything take one hue.
  AppAccent get secondaryAccent => _secondaryAccent;
  double get desktopFontScale => _desktopFontScale;

  String get defaultReplicaId => _defaultReplicaId;
  String get defaultPersonaId => _defaultPersonaId;

  DraftForm get sessionConfig => _sessionConfig;

  TavusConversation? get currentConversation => _currentConversation;
  List<String> get questions => List.unmodifiable(_questions);
  int get currentQuestionIdx => _currentQuestionIdx;
  bool get interviewActive => _interviewActive;
  List<Draft> get drafts => List.unmodifiable(_drafts);


  int get confidence => _confidence;
  int get anxiety => _anxiety;
  int get wpm => _wpm;
  int get fillers => _fillers;
  int get engagement => _engagement;

  List<int> get questionTimestamps => List.unmodifiable(_questionTimestamps);

  List<TranscriptEntry> get sessionTranscript =>
      List.unmodifiable(_sessionTranscript);
  bool get deepgramConnected => _deepgramConnected;
  bool get storeLocalRecordings => _storeLocalRecordings;
  List<int>? get recordingBytes => _recordingBytes;
  String? get pendingAnalysisConvId => _pendingAnalysisConvId;
  InterviewProcessingStage get processingStage => _processingStage;
  String? get processingError => _processingError;
  bool get activeInterviewIsPractice => _activeInterviewIsPractice;
  int? get recordingStartTimestamp => _recordingStartTimestamp;
  List<SavedRecording> get recordings => List.unmodifiable(_recordings);
  List<InterviewResult> get interviewResults =>
      List.unmodifiable(_interviewResults);

  AppStore() {
    loadFromPrefs();
  }

  Future<void> loadFromPrefs() {
    _loadFuture ??= _loadFromPrefs();
    return _loadFuture!;
  }

  // Setters
  void setStoreLocalRecordings(bool enable) {
    _storeLocalRecordings = enable;
    _saveToPrefs();
    notifyListeners();
  }

  void setThemeMode(ThemeMode mode) {
    if (_themeMode != mode) {
      _themeMode = mode;
      _saveToPrefs();
      notifyListeners();
    }
  }

  void setAccent(AppAccent accent) {
    if (_accent != accent) {
      _accent = accent;
      _saveToPrefs();
      notifyListeners();
    }
  }

  void setSecondaryAccent(AppAccent accent) {
    if (_secondaryAccent != accent) {
      _secondaryAccent = accent;
      _saveToPrefs();
      notifyListeners();
    }
  }

  void setDesktopFontScale(double scale) {
    if (_desktopFontScale != scale) {
      _desktopFontScale = scale;
      _saveToPrefs();
      notifyListeners();
    }
  }

  void setDefaultReplicaId(String id) {
    _defaultReplicaId = id;
    _saveToPrefs();
    notifyListeners();
  }

  void setDefaultPersonaId(String id) {
    _defaultPersonaId = id;
    _saveToPrefs();
    notifyListeners();
  }

  // Persists the full session configuration. Each settings section merges its
  // own fields via DraftForm.copyWith before calling this.
  void setSessionConfig(DraftForm config) {
    _sessionConfig = config;
    _saveToPrefs();
    notifyListeners();
  }

  void setCurrentConversation(TavusConversation? c) {
    _currentConversation = c;
    notifyListeners();
  }

  // Full language name of the interview currently being taken (e.g. 'Spanish').
  // Set at launch; read by the results page to pick the Deepgram locale for
  // post-call transcription. Ephemeral (not persisted).
  String _activeInterviewLanguage = 'English';
  String get activeInterviewLanguage => _activeInterviewLanguage;
  void setActiveInterviewLanguage(String language) {
    final v = language.trim();
    _activeInterviewLanguage = v.isEmpty ? 'English' : v;
  }

  // The current interview's role/title + duration, so the results pipeline
  // scores against the real role (not a hardcoded default). Ephemeral.
  String _activeInterviewRole = 'Candidate';
  int _activeInterviewDurationSeconds = 0;
  String get activeInterviewRole => _activeInterviewRole;
  int get activeInterviewDurationSeconds => _activeInterviewDurationSeconds;
  void setActiveInterviewMeta({required String role, required int durationSeconds}) {
    _activeInterviewRole = role.trim().isEmpty ? 'Candidate' : role.trim();
    _activeInterviewDurationSeconds = durationSeconds > 0 ? durationSeconds : 0;
  }

  // Integrity: times the candidate backgrounded the app during the current
  // video interview. Reset at launch, read when the result is persisted so the
  // recruiter can see it. Ephemeral.
  int _integrityLeftAppCount = 0;
  int get integrityLeftAppCount => _integrityLeftAppCount;
  void incrementIntegrityLeftApp() => _integrityLeftAppCount++;
  void resetIntegrity() => _integrityLeftAppCount = 0;

  void setQuestions(List<String> qs) {
    _questions = qs;
    _saveToPrefs();
    notifyListeners();
  }

  void setCurrentQuestionIdx(int idx) {
    _currentQuestionIdx = idx;
    if (_interviewActive) {
      pushQuestionTimestamp(DateTime.now().millisecondsSinceEpoch);
    }
    notifyListeners();
  }

  void setInterviewActive(bool active) {
    _interviewActive = active;
    if (active) {
      pushQuestionTimestamp(DateTime.now().millisecondsSinceEpoch);
    }
    notifyListeners();
  }

  void updateMetrics({int? conf, int? anx, int? w, int? f, int? eng}) {
    if (conf != null) _confidence = conf;
    if (anx != null) _anxiety = anx;
    if (w != null) _wpm = w;
    if (f != null) _fillers = f;
    if (eng != null) _engagement = eng;
    notifyListeners();
  }

  void saveDraft(String name, DraftForm form, List<String> qs) {
    final newDraft = Draft(
      id: 'draft-${DateTime.now().millisecondsSinceEpoch}',
      name: name,
      savedAt: DateTime.now().toIso8601String(),
      form: form,
      questions: qs,
    );

    // Remove existing draft with same name to avoid duplicates
    _drafts.removeWhere((d) => d.name == name);
    _drafts.insert(0, newDraft);

    _saveToPrefs();
    notifyListeners();
  }

  void deleteDraft(String id) {
    _drafts.removeWhere((d) => d.id == id);
    _saveToPrefs();
    notifyListeners();
  }

  void pushQuestionTimestamp(int ts) {
    _questionTimestamps.add(ts);
    notifyListeners();
  }

  void resetQuestionTimestamps() {
    _questionTimestamps = [];
    notifyListeners();
  }

  void setRecordingStartTimestamp(int? ts) {
    _recordingStartTimestamp = ts;
    notifyListeners();
  }

  void pushTranscriptEntry(TranscriptEntry entry) {
    _sessionTranscript.add(entry);
    notifyListeners();
  }

  void updateTranscriptEntries(List<TranscriptEntry> entries) {
    _sessionTranscript = entries;
    notifyListeners();
  }

  void clearSessionTranscript() {
    _sessionTranscript = [];
    notifyListeners();
  }

  void setDeepgramConnected(bool connected) {
    _deepgramConnected = connected;
    notifyListeners();
  }

  void setRecordingBytes(List<int>? bytes) {
    _recordingBytes = bytes;
    notifyListeners();
  }

  /// Marks [conversationId] as needing the post-interview analysis pipeline
  /// (transcript → Gemini → recruiter handoff) and puts the candidate-facing
  /// status at its first stage. Called once, right when the candidate ends the
  /// call and is navigated to /results — on every platform, not just native
  /// (where a local recording exists).
  void markPendingAnalysis(String conversationId) {
    _pendingAnalysisConvId = conversationId;
    _processingStage = InterviewProcessingStage.fetchingTranscript;
    _processingError = null;
    notifyListeners();
  }

  void setProcessingStage(InterviewProcessingStage stage, {String? error}) {
    _processingStage = stage;
    _processingError = error;
    notifyListeners();
  }

  /// Resets processing status ahead of a new interview so a previous session's
  /// stage/error never leaks into the next one.
  /// Marks whether the run being launched is self-serve practice. Set by
  /// video_launch (practice == no assigned Interview) before the call starts.
  void setActiveInterviewIsPractice(bool value) {
    _activeInterviewIsPractice = value;
    notifyListeners();
  }

  void resetProcessingStage() {
    _pendingAnalysisConvId = null;
    _processingStage = InterviewProcessingStage.idle;
    _processingError = null;
    notifyListeners();
  }

  void addRecording(SavedRecording recording) {
    _recordings.insert(0, recording);
    _saveToPrefs();
    notifyListeners();
  }

  void deleteRecording(String id) {
    _recordings.removeWhere((r) => r.id == id);
    _saveToPrefs();
    notifyListeners();
  }

  /// Saves (or replaces, keyed by conversationId) a finished interview result.
  void addInterviewResult(InterviewResult result) {
    _interviewResults.removeWhere(
      (r) => r.conversationId == result.conversationId &&
          result.conversationId.isNotEmpty,
    );
    _interviewResults.insert(0, result);
    _saveToPrefs();
    notifyListeners();
  }

  void deleteInterviewResult(String id) {
    _interviewResults.removeWhere((r) => r.id == id);
    _saveToPrefs();
    notifyListeners();
  }

  void reset() {
    _currentConversation = null;
    _currentQuestionIdx = 0;
    _interviewActive = false;
    _confidence = 0;
    _anxiety = 0;
    _wpm = 0;
    _fillers = 0;
    _engagement = 0;
    _questionTimestamps = [];
    _sessionTranscript = [];
    _deepgramConnected = false;
    _recordingBytes = null;
    _pendingAnalysisConvId = null;
    _processingStage = InterviewProcessingStage.idle;
    _processingError = null;
    // Fail closed: an unset flag must never mark an assigned run as practice.
    // Every launch sets it explicitly, so this is just hygiene.
    _activeInterviewIsPractice = false;
    notifyListeners();
  }

  // Load from local storage
  Future<void> _loadFromPrefs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final String? rawData = prefs.getString(_kStoreKey);
      if (rawData == null) return;

      final Map<String, dynamic> data = jsonDecode(rawData);

      if (data['themeMode'] != null) {
        _themeMode = ThemeMode.values.firstWhere(
          (e) => e.name == data['themeMode'],
          orElse: () => ThemeMode.dark,
        );
      } else {
        _themeMode = ThemeMode.dark;
    _accent = AppAccent.peach;
    _secondaryAccent = AppAccent.lavender;
      }

      // Unknown or absent values fall back to the default rather than
      // throwing, so an older build's prefs still load.
      _accent = AppAccentX.fromWire(data['accent'] as String?);
      _secondaryAccent = AppAccentX.fromWire(
        data['secondaryAccent'] as String?,
        fallback: AppAccent.lavender,
      );

      _storeLocalRecordings = data['storeLocalRecordings'] ?? false;

      final rawScale = data['desktopFontScale'];
      if (rawScale is num && rawScale > 0) {
        _desktopFontScale = rawScale.toDouble();
      }

      _defaultReplicaId = data['defaultReplicaId'] ?? '';
      _defaultPersonaId = data['defaultPersonaId'] ?? '';

      // Restore saved session config, else seed it with the default replica/persona.
      if (data['sessionConfig'] != null) {
        _sessionConfig = DraftForm.fromJson(data['sessionConfig']);
      } else {
        _sessionConfig = DraftForm.defaults().copyWith(
          replicaId: _defaultReplicaId,
          personaId: _defaultPersonaId,
        );
      }

      if (data['questions'] != null) {
        _questions = List<String>.from(data['questions']);
      }

      if (data['drafts'] != null) {
        final List draftsList = data['drafts'];
        _drafts = draftsList.map((d) => Draft.fromJson(d)).toList();
      }



      if (data['recordings'] != null) {
        final List recordingsList = data['recordings'];
        _recordings = recordingsList.map((r) => SavedRecording.fromJson(r)).toList();
      }

      if (data['interviewResults'] != null) {
        final List resultsList = data['interviewResults'];
        _interviewResults =
            resultsList.map((r) => InterviewResult.fromJson(r)).toList();
      }

      notifyListeners();
    } catch (e) {
      debugPrint('Error loading store: $e');
    } finally {
      // Persistence is unblocked only after the initial load settles (success,
      // early-return on empty prefs, or error) so subsequent setters can save.
      _loaded = true;
    }
  }

  // Save key credentials and drafts to local storage
  Future<void> _saveToPrefs() async {
    // Ignore writes triggered before the initial load finishes: a setter firing
    // during startup must not overwrite persisted data with defaults.
    if (!_loaded) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final Map<String, dynamic> data = {
        'themeMode': _themeMode.name,
        'accent': _accent.wire,
        'secondaryAccent': _secondaryAccent.wire,
        'defaultReplicaId': _defaultReplicaId,
        'defaultPersonaId': _defaultPersonaId,
        'sessionConfig': _sessionConfig.toJson(),
        'storeLocalRecordings': _storeLocalRecordings,
        'desktopFontScale': _desktopFontScale,
        'questions': _questions,
        'drafts': _drafts.map((d) => d.toJson()).toList(),
        'recordings': _recordings.map((r) => r.toJson()).toList(),
        'interviewResults': _interviewResults.map((r) => r.toJson()).toList(),
      };
      await prefs.setString(_kStoreKey, jsonEncode(data));
    } catch (e) {
      debugPrint('Error saving store: $e');
    }
  }

  // Clear preferences
  Future<void> clearAllPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kStoreKey);
    reset();
    _themeMode = ThemeMode.dark;
    _accent = AppAccent.peach;
    _secondaryAccent = AppAccent.lavender;
    _desktopFontScale = 1.0;
    _defaultReplicaId = '';
    _defaultPersonaId = '';
    _sessionConfig = DraftForm.defaults();
    _questions = [
      'Tell me about yourself and your background.',
      'Describe a challenging problem you solved recently.',
      'How do you handle pressure and tight deadlines?',
      'Where do you see yourself in 3 years?',
      'Do you have any questions for us?',
    ];
    _drafts = [];
    _recordings = [];
    _interviewResults = [];
    notifyListeners();
  }
}
