"""Company normalisation.

Mirrors `web_version/talbotiq-platform/src/lib/companyKey.test.ts` case for case,
so the key the browser computes at sign-up and the key the server compares against
cannot drift apart. If one side changes, both test files must.

The two halves are equally important:

  · names that MUST collapse to one key — otherwise colleagues at one company
    cannot see each other's work;
  · names that MUST NOT collapse — otherwise two companies share a data bucket,
    which is the failure nobody notices.
"""

from __future__ import annotations

import pytest

from app.web.shared.company import (
    company_display,
    company_key,
    same_company,
)


class TestNamesThatMeanTheSameCompany:
    @pytest.mark.parametrize(
        "typed",
        ["Talbotiq", "talbotiq", "taLbotiq", "TALBOTIQ", "  Talbotiq  ", "\tTalbotiq\n"],
    )
    def test_case_and_surrounding_space_do_not_matter(self, typed):
        assert company_key(typed) == "talbotiq"

    def test_internal_whitespace_is_collapsed(self):
        assert company_key("Talbotiq   Technologies") == "talbotiq technologies"
        assert company_key("Talbotiq\tTechnologies") == "talbotiq technologies"

    def test_full_width_characters_normalise_to_ascii(self):
        """Ｔ and T look the same to a person and must not be two companies."""
        assert company_key("Ｔalbotiq") == "talbotiq"

    def test_invisible_characters_are_stripped(self):
        """A zero-width joiner is invisible in every UI.

        Without this, one pasted name could create a second company that looks
        byte-for-byte identical on screen and shares nothing.
        """
        assert company_key("Talbo​tiq") == "talbotiq"
        assert company_key("﻿Talbotiq") == "talbotiq"

    def test_same_company_accepts_any_spelling(self):
        assert same_company("TalbotIQ", "  talbotiq ") is True


class TestNamesThatAreDifferentCompanies:
    def test_a_legal_suffix_is_not_stripped(self):
        """The cautious direction.

        Wrongly splitting one company is an annoyance somebody reports. Wrongly
        merging two is a cross-company leak nobody notices. So no guessing.
        """
        assert company_key("Talbotiq") != company_key("Talbotiq Ltd")

    def test_punctuation_is_not_stripped(self):
        assert company_key("Talbot-iq") != company_key("Talbotiq")

    def test_different_names_do_not_match(self):
        assert same_company("Talbotiq", "Acme") is False


class TestTheAbsentCase:
    @pytest.mark.parametrize("blank", [None, "", "   ", "\t\n", "​"])
    def test_a_missing_name_has_an_empty_key(self, blank):
        assert company_key(blank) == ""

    def test_two_unknowns_are_not_the_same_company(self):
        """The leak this guards.

        If absent matched absent, every account with no company recorded would
        land in one shared bucket and see each other's templates.
        """
        assert same_company(None, None) is False
        assert same_company("", "") is False

    def test_a_known_company_never_matches_an_unknown_one(self):
        assert same_company("Talbotiq", None) is False
        assert same_company(None, "Talbotiq") is False


class TestDisplayName:
    def test_the_typed_capitalisation_survives(self):
        """"TalbotIQ" must appear as "TalbotIQ", not flattened to "talbotiq"."""
        assert company_display("  TalbotIQ  ") == "TalbotIQ"

    def test_display_still_tidies_whitespace(self):
        assert company_display("Talbotiq   Technologies") == "Talbotiq Technologies"

    def test_display_and_key_agree_on_which_company_it_is(self):
        typed = "  TalbotIQ   Technologies "
        assert company_key(company_display(typed)) == company_key(typed)


def test_a_very_long_name_is_bounded():
    """It rides in every document and every query; unbounded input does not."""
    assert len(company_key("A" * 500)) == 120
