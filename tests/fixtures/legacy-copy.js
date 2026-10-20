'use strict';
// Invented data in the layout of the legacy copy (docs: migration/LEGACY-DATA-PROFILE.md).
// SETTINGS: no header row; column A the store (some with trailing spaces), column B the region.
const SETTINGS = [
  ['TEST STORE ONE', 'NCR'],
  ['DOÑA TEST ', 'NCR '],
  ['test store one', 'NCR'],
  ['SECOND TEST STORE', 'Cebu Test'],
  ['PROVINCIAL  TEST', 'Cebu Test'],
  ['REGIONLESS STORE', ''],
  ['', 'NCR'],
];

// SEED_OFFICERS: header display_name, role, hr_employee_no, is_active. Invented names and numbers.
const SEED_OFFICERS = [
  ['display_name', 'role', 'hr_employee_no', 'is_active'],
  ['Olivia Tester', 'Training Officer', '9001', 'TRUE'],
  ['Marco Sample', 'Training Officer', '9002', 'TRUE'],
  ['Ada Admin', 'Admin', '9003', 'TRUE'],
  ['Pat Retired', 'Training Officer', '9004', 'FALSE'],
  ['Wrong Role', 'Boss', '9005', 'TRUE'],
  ['Twin Number', 'Training Officer', '9002', 'TRUE'],
  ['olivia  tester', 'Training Officer', '9006', 'TRUE'],
];

module.exports = { SETTINGS, SEED_OFFICERS, LEGACY_ID: 'legacy-copy-id' };
