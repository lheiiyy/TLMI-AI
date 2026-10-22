'use strict';
// Invented officer decisions for the fixture MASTER_LOG (tests/fixtures/master-log.js), in the shape that
// tests/helpers/import-env.js writes into the review sheet. Names are invented. Sheet rows 2 to 12 of MASTER_LOG.
//
// With these decisions the rows 2 to 9 are READY, row 11 (RESULT "MAYBE") is NOT_READY with STATUS_BAD, and row 12
// (entry date "next week", person not decided) is NOT_READY with PERSON_UNCONFIRMED and ENTRY_DATE_BAD.
const BASELINE = {
  // persons_proposed: key is the proposed name (normalised); the value is the decision, or [decision, corrected_value]
  persons: {
    'MARCO TESTER': 'confirm',
    'ANA SAMPLE': 'confirm',
    'REA SAMPLE': ['correct value', 'SAMPLE | REA | | '],
    'DARYL FAYE C SAMPLE': 'confirm',
    'DARYL FAYE SAMPLE': 'confirm',
    'LEO TESTER': 'confirm',
    'KIM SAMPLE': 'confirm',
    'PAT SAMPLE': 'confirm',
  },
  // possible_duplicates: 'name_a | name_b' -> decision
  duplicates: {
    'DARYL FAYE C. SAMPLE | DARYL FAYE SAMPLE': 'confirm',
  },
  // name_mapping: [kind, raw_value, decision, corrected_value]
  mapping: [
    ['store', 'DONA TEST', 'confirm', 'DOÑA TEST'],
    ['store', 'UNKNOWN PROVINCE', 'confirm', 'PROVINCIAL TEST'],
    ['station', 'PIZZA MAKER*', 'confirm', 'Pizza Maker'],
  ],
  // bad_values: [source_row, column, decision, corrected_value]
  bad: [
    [3, 'istv', 'confirm'],
    [7, 'date_certified', 'drop value'],
    [8, 'techval_fp', 'drop value'],
    [9, 'date_certified', 'confirm'],
  ],
};

module.exports = { BASELINE };
