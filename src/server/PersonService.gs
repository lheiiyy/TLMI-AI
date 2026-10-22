// Persons and their aliases (Phase 2 spec section 9). The only writer of `persons` and `person_aliases` (TDMS P4).
// A person is never merged automatically; duplicate candidates are proposals only. The audit row for a created person
// belongs to the call that creates it (TL.ENROLLED, or the import), which runs this inside its own transaction.
const PersonService = (function () {
  const tidy = (s) => String(s === undefined || s === null ? '' : s).trim().replace(/\s+/g, ' ');
  const actorOf = (ctx) => ({ userId: ctx.userId || '', now: ctx.now });

  function displayName(p) {
    return [p.first_name, p.middle_name, p.last_name, p.suffix].map(tidy).filter((s) => s !== '').join(' ');
  }

  function aliasKey(type, value) {
    return type === 'NAME' ? ImportRules.normalizeName(value) : tidy(value);
  }

  // Adds an alias unless this person already has the same one. Returns the new row, or null.
  function addAlias(uow, ctx, personId, aliasType, value, validFrom) {
    const v = tidy(value);
    const key = aliasKey(aliasType, v);
    const dup = uow.all('person_aliases').some((a) => a.person_id === personId && a.alias_type === aliasType && aliasKey(aliasType, a.value) === key);
    if (dup) return null;
    const row = { person_id: personId, alias_type: aliasType, value: v };
    if (validFrom) row.valid_from = validFrom;
    return uow.append('person_aliases', row, actorOf(ctx));
  }

  // fields: { last_name, first_name, middle_name?, suffix?, hr_employee_no?, legacy_ref? }
  function create(uow, ctx, fields) {
    const values = {};
    ['last_name', 'first_name', 'middle_name', 'suffix', 'hr_employee_no', 'legacy_ref'].forEach((k) => {
      if (fields[k] === undefined || fields[k] === null) return;
      const t = tidy(fields[k]);
      if (t !== '' || k === 'last_name' || k === 'first_name') values[k] = t;
    });
    const no = values.hr_employee_no;
    if (no && uow.all('person_aliases').some((a) => a.alias_type === 'HR_NO' && a.value === no)) {
      throw Errors.validation([{ path: 'hr_employee_no', code: 'DUPLICATE', message: 'This value already exists.' }]);
    }
    const person = uow.insert('persons', values, actorOf(ctx));
    if (no) addAlias(uow, ctx, person.id, 'HR_NO', no, Clock.today());
    return person;
  }

  // Possible duplicates of `input` among `persons` (spec 6, TDMS D006). One entry per person, with the strongest reason.
  function candidates(persons, aliases, input) {
    const wantNo = tidy(input.hr_employee_no);
    const wantName = ImportRules.normalizeName(displayName(input));
    const out = [];
    persons.forEach((p) => {
      const names = [ImportRules.normalizeName(displayName(p))].concat(
        aliases.filter((a) => a.person_id === p.id && a.alias_type === 'NAME').map((a) => ImportRules.normalizeName(a.value)));
      const numbers = [p.hr_employee_no].concat(aliases.filter((a) => a.person_id === p.id && a.alias_type === 'HR_NO').map((a) => a.value));
      let reason = null;
      if (wantNo && numbers.indexOf(wantNo) >= 0) reason = 'SAME_HR_NO';
      else if (wantName && names.indexOf(wantName) >= 0) reason = 'SAME_NAME';
      else if (wantName && names.some((n) => n && ImportRules.near(wantName, n))) reason = 'SIMILAR_NAME';
      if (reason) out.push({ person_id: p.id, name: displayName(p), reason: reason });
    });
    const rank = { SAME_HR_NO: 0, SAME_NAME: 1, SIMILAR_NAME: 2 };
    return out.sort((a, b) => rank[a.reason] - rank[b.reason] || (a.person_id < b.person_id ? -1 : 1));
  }

  function methods() {
    return {
      'persons.get': {
        kind: 'R', params: { id: { type: 'text', required: true, max: 40 } },
        handler: (ctx, p) => {
          const person = Repository.get('persons', p.id);
          if (!person) throw Errors.notFound();
          return {
            person: person,
            name: displayName(person),
            aliases: Repository.all('person_aliases').filter((a) => a.person_id === p.id),
            enrollments: Repository.all('tl_enrollments').filter((e) => e.person_id === p.id)
              .map((e) => ({ id: e.id, status: e.status, entry_date: e.entry_date, deadline: e.deadline, mother_location_id: e.mother_location_id })),
          };
        },
      },
      'persons.matchCandidates': {
        kind: 'R',
        params: {
          last_name: { type: 'text', required: true, max: 100 }, first_name: { type: 'text', required: true, max: 100 },
          middle_name: { type: 'text', max: 100 }, hr_employee_no: { type: 'text', max: 20 },
        },
        handler: (ctx, p) => candidates(Repository.all('persons'), Repository.all('person_aliases'), p),
      },
    };
  }

  return { create: create, addAlias: addAlias, candidates: candidates, displayName: displayName, methods: methods };
})();
