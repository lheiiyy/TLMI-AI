'use strict';
// Invented MASTER_LOG and UNIFORM_LOG rows with the patterns of the real legacy sheet
// (docs: migration/LEGACY-DATA-PROFILE.md): odd headers, two date formats, percent text, scaled grades, zero dates,
// officers spelled several ways, notes typed in the officer column, uniform cells with several parts.
// All names are invented. Sheet row numbers: the header is row 1, the first data row is row 2.

const MASTER_LOG_HEADER = [
  '', 'Date of Entry', 'Batch # ', 'Mother Store', 'Full name', 'Mother Station', 'SUPPORT STORE', 'RESULT', 'Uniform Release',
  'ENTRY BY', 'ISTV GRADE', 'TECHVAL FP', 'TECHVAL PM', 'TL-ENTRY FOOD PREP EXAM', 'TL-ENTRY PIZZA MAKER EXAM', 'TL ENTRY AVERAGE ',
  'CERTIFICATION DEADLINE', 'CERT BY:', 'DATE CERTIFIED', 'CERTFICATION  GRADE', 'EXAM GRADE', 'AVERAGE', 'STATUS',
];

// Column order: form timestamp, entry date, batch, mother store, full name, station, support store, result, uniform,
// entry by, istv, techval fp, techval pm, exam fp, exam pm, entry average, deadline, cert by, date certified,
// cert grade, exam grade, average, status
const MASTER_LOG_ROWS = [
  /* 2 */ ['10/03/2026 09:00:00', '14 Nov 2025', 'BATCH 1', 'TEST STORE ONE', 'MARCO TESTER', 'FOOD PREP', 'NONE', 'CERTIFIED', '3 SMALL | 1 LARGE', 'OLIVIA', '95%', '90%', '92%', '88%', '91%', '91%', '', 'OLIVIA', '20/02/2026', '90%', '88%', '89%', 'SIGNED'],
  /* 3 */ ['', '14 Nov 2025', 'BATCH 1', 'DONA TEST', 'ANA SAMPLE', 'PIZZA MAKER*', '', 'PROMOTION', '2 MEDIUM', 'OLIVA', '9475%', '90%', '90%', '90%', '90%', '90%', '', 'OLIVIA | MARCO', '25/02/2026', '90%', '90%', '90%', 'ON-GOING PROMOTION'],
  /* 4 */ ['', '2 Mar 2025', 'BATCH 2', 'SECOND TEST STORE', 'REA SAMPLE', 'CASHIER', '', 'QUIT', '', 'OLIVIA ', '80%', '', '', '', '', '', '', 'NO CERT', '', '', '', '', 'RESIGNED'],
  /* 5 */ ['', '5 Aug 2026', 'BATCH 10', 'SECOND TEST STORE', 'REA SAMPLE', 'CASHIER', '', 'PROBATIONARY', '1 XLARGE (DR#700003248)', 'MARCO', '85%', '', '', '', '', '', '5 Aug 2026', '', '', '', '', '', 'FOR REPORTING'],
  /* 6 */ ['', '14 Nov 2025', 'BATCH 1', 'UNKNOWN PROVINCE', 'DARYL FAYE C. SAMPLE', 'SERVICE', 'TEST STORE ONE', 'EXTENDED', '', 'ZED', '70%', '', '', '', '', '', '23/12/2026 08:00:00', 'GIO / 2ND EXTEND', '', '', '', '', ''],
  /* 7 */ ['', '29 Oct 2025', 'SPECIAL', 'TEST STORE ONE', 'DARYL FAYE SAMPLE', 'COMMIS', '', 'DISQUALIFIED', 'big shirt | 2 HUGE', 'OLIVIA', '60%', '', '', '', '', '', '', 'MARCO', '24/01/2025', '', '', '', ''],
  /* 8 */ ['', '14 Nov 2025', 'BATCH 3', 'TEST STORE ONE', 'LEO TESTER', 'DOUGH MAKER', '', 'FAILED', '', 'MARCO', '88%', '30 Dec 1899', '', '', '', '', '', 'MARCO', '', '', '', '', ''],
  /* 9 */ ['', '12 Dec 2025', 'BATCH 3', 'SECOND TEST STORE', 'KIM SAMPLE', 'FOOD PREP', '', 'CERTIFIED', '', 'OLIVIA', '90%', '', '', '', '', '', '', 'OLIVIA', '08/12/2026', '90%', '90%', '90%', '42'],
  /* 10 */ ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  /* 11 */ ['', '12 Dec 2025', 'BATCH 4', 'DOÑA TEST', 'PAT SAMPLE', 'PIZZA MAKER', '', 'MAYBE', '', 'OLIVIA', '90%', '', '', '', '', '', '', '', '', '', '', '', ''],
  /* 12 */ ['', 'next week', 'BATCH 4', 'PROVINCIAL TEST', 'SAM SAMPLE', 'CASHIER', 'NONE', 'PROBATIONARY', '1 MEDIUM', '', '', '', '', '', '', '', '', '', '', '', '', '', 'NEW ENTRY'],
];

const UNIFORM_LOG_HEADER = ['Timestamp', 'TL Key', 'Full Name', 'Mother Store', 'Size', 'Quantity', 'DR #', 'Given By', 'Notes'];
const UNIFORM_LOG_ROWS = [
  /* 2 */ ['28/09/2026 10:00:00', 'MARCO TESTER||TEST STORE ONE||2025-11-14', 'MARCO TESTER', 'TEST STORE ONE', 'MEDIUM', '2', '700000001', 'OLIVIA', ''],
  /* 3 */ ['29/09/2026 11:30:00', 'ANA SAMPLE||DONA TEST||2025-11-14', 'ANA SAMPLE', 'DONA TEST', 'LARGE', '1', '', 'N/A', 'to follow'],
  /* 4 */ ['30/09/2026 08:15:00', 'REA SAMPLE||SECOND TEST STORE||2026-08-05', 'REA SAMPLE', 'SECOND TEST STORE', 'HUGE', 'two', '', 'OLIVIA', ''],
];

module.exports = { MASTER_LOG_HEADER, MASTER_LOG_ROWS, UNIFORM_LOG_HEADER, UNIFORM_LOG_ROWS };
