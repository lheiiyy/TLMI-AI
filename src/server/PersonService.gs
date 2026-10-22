// Persons and their aliases (Phase 2 spec sections 5 and 9). PersonService is the only writer of `persons` and
// `person_aliases` (TDMS P4). A person is created by tl.enroll or by the legacy import, never by its own method (P2-7).
// A duplicate is only ever proposed, never merged (TDMS D006).
const PersonService = (function () {
  const tidy = (s) => String(s === undefined || s === null ? '' : s).trim().replace(/\s+/g, ' ');

  // 'FIRST MIDDLE LAST SUFFIX', with the parts that exist.
  function displayName(p) {
    return [p.first_name, p.middle_name, p.last_name, p.suffix].map(tidy).filter((x) => x).join(' ');
  }

  const sortedTokens = (s) => ImportRules.normalizeName(s).split(' ').filter((t) => t).sort().join(' ');

  // The alias value as stored for a type: names as typed (tidied), numbers as digits.
  function aliasValue(type, value) { return tidy(value); }

  // One alias row, unless the person already has this type and value (compared as names are: case, spaces and punctuation
  // do not count). Returns the new row, or null.
  function addAlias(uow, ctx, personId, aliasType, value, validFrom) {
    const v = aliasValue(aliasType, value);
    if (!v) return null;
    const key = aliasType === 'NAME' ? ImportRules.normalizeName(v) : v;
    const same = uow.all('person_aliases').some((a) => a.person_id === personId && a.alias_type === aliasType
      && (aliasType === 'NAME' ? ImportRules.normalizeName(a.value) : a.value) === key);
    if (same) return null;
    const row = { person_id: personId, alias_type: aliasType, value: v };
    if (validFrom) row.valid_from = validFrom;
    return uow.append('person_aliases', row, { userId: ctx.userId, now: ctx.now });
  }

  // Creates a person: names tidied (trimmed, spaces collapsed), an HR_NO alias when a number is given. A number that
  // another person has is a VALIDATION error (DUPLICATE), not a warning.
  function create(uow, ctx, p) {
    const values = {
      last_name: tidy(p.last_name), first_name: tidy(p.first_name),
    };
    ['middle_name', 'suffix', 'hr_employee_no', 'legacy_ref'].forEach((f) => { if (p[f] !== undefined && p[f] !== null && tidy(p[f]) !== '') values[f] = tidy(p[f]); });
    const row = uow.insert('persons', values, { userId: ctx.userId, now: ctx.now });
    if (row.hr_employee_no) addAlias(uow, ctx, row.id, 'HR_NO', row.hr_employee_no, ctx.today);
    return row;
  }

  // Possible duplicates of `input` among `persons`, as proposals: the strongest reason per person.
  //   SAME_HR_NO     the same HR number (on the person or as an HR_NO alias)
  //   SAME_NAME      the same name once case, spaces and punctuation are ignored, or the same words in another order,
  //                  or the same as a NAME alias
  //   SIMILAR_NAME   a name the import review's `near` rule calls near (a spelling slip, an extra middle initial)
  function candidates(persons, aliases, input) {
    const no = tidy(input.hr_employee_no);
    const full = displayName(input);
    const norm = ImportRules.normalizeName(full);
    const sorted = sortedTokens(full);
    const rank = { SAME_HR_NO: 0, SAME_NAME: 1, SIMILAR_NAME: 2 };
    const out = {};
    const offer = (person, reason) => {
      const cur = out[person.id];
      if (!cur || rank[reason] < rank[cur.reason]) out[person.id] = { person_id: person.id, name: displayName(person), reason: reason };
    };
    const aliasOf = (id) => aliases.filter((a) => a.person_id === id);
    persons.forEach((p) => {
      const mine = aliasOf(p.id);
      if (no && (p.hr_employee_no === no || mine.some((a) => a.alias_type === 'HR_NO' && a.value === no))) { offer(p, 'SAME_HR_NO'); return; }
      if (!norm) return;
      const names = [displayName(p)].concat(mine.filter((a) => a.alias_type === 'NAME').map((a) => a.value));
      if (names.some((n) => ImportRules.normalizeName(n) === norm || sortedTokens(n) === sorted)) { offer(p, 'SAME_NAME'); return; }
      if (names.some((n) => ImportRules.near(norm, ImportRules.normalizeName(n)))) offer(p, 'SIMILAR_NAME');
    });
    return Object.keys(out).map((k) => out[k]).sort((a, b) => rank[a.reason] - rank[b.reason] || (a.name < b.name ? -1 : 1));
  }

  function methods() {
    return {
      'persons.get': {
        kind: 'R', params: { id: { type: 'text', required: true, max: 40 } },
        handler: (ctx, p) => {
          const person = Repository.get('persons', p.id);
          if (!person) throw Errors.notFound();
          const aliases = Repository.all('person_aliases').filter((a) => a.person_id === p.id);
          const enrollments = Repository.all('tl_enrollments').filter((e) => e.person_id === p.id)
            .sort((a, b) => (a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : 0))
            .map((e) => ({ id: e.id, status: e.status, entry_date: e.entry_date, deadline: e.deadline, batch_code: e.batch_code, final_grade: e.final_grade }));
          return { person: Object.assign({}, person, { display_name: displayName(person) }), aliases: aliases, enrollments: enrollments };
        },
      },
      'persons.matchCandidates': {
        kind: 'R',
        params: {
          last_name: { type: 'text', required: true, max: 100 }, first_name: { type: 'text', required: true, max: 100 },
          middle_name: { type: 'text', max: 100 }, suffix: { type: 'text', max: 20 },
          hr_employee_no: { type: 'text', max: 20, pattern: /^\d{1,20}$/, patternMessage: 'Digits only.' },
        },
        handler: (ctx, p) => candidates(Repository.all('persons'), Repository.all('person_aliases'), p),
      },
    };
  }

  return { displayName: displayName, create: create, addAlias: addAlias, candidates: candidates, methods: methods };
})();
