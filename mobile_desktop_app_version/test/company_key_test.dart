import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/features/auth/company_key.dart';

void main() {
  group('company key agrees with the server and the web client', () {
    // Cases lifted from backend/tests/web/test_web_company.py and
    // src/lib/companyKey.test.ts, so all three are asserted on the same inputs.
    test('case and whitespace collapse to one key', () {
      for (final typed in ['Talbotiq', 'talbotiq', 'taLbotiq', '  Talbotiq  ']) {
        expect(normalizeCompanyKey(typed), 'talbotiq', reason: typed);
      }
    });

    test('internal whitespace runs collapse', () {
      expect(normalizeCompanyKey('Acme   Corp'), 'acme corp');
    });

    test('invisible characters cannot create a second company', () {
      expect(normalizeCompanyKey('Talbot​iq'), 'talbotiq');
      expect(normalizeCompanyKey('﻿Talbotiq'), 'talbotiq');
    });

    test('legal suffixes are NOT stripped', () {
      // Wrongly splitting one company is a visible annoyance; wrongly merging two is
      // a leak nobody notices.
      expect(normalizeCompanyKey('Talbotiq Ltd') == normalizeCompanyKey('Talbotiq'),
          isFalse);
    });

    test('missing is empty, never a wildcard', () {
      expect(normalizeCompanyKey(null), '');
      expect(normalizeCompanyKey('   '), '');
    });

    test('two unknowns are not a match', () {
      expect(sameCompany(null, null), isFalse);
      expect(sameCompany('', ''), isFalse);
      expect(sameCompany('Talbotiq', 'talbotiq'), isTrue);
    });

    test('display keeps capitalisation', () {
      expect(normalizeCompanyDisplay('  TalbotIQ  '), 'TalbotIQ');
    });
  });
}
