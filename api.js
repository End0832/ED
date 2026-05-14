const PROXY = 'https://icy-night-46e3.end-b76.workers.dev'
const API_VERSION = '4.90.1'

let xToken = null
let mfaCredentials = null

// ── Storage ────────────────────────────────────────────────────────────────
function saveCredentials(u, p) { localStorage.setItem('ed_u', u); localStorage.setItem('ed_p', p) }
function loadCredentials() {
  const u = localStorage.getItem('ed_u'), p = localStorage.getItem('ed_p')
  return u && p ? { username: u, password: p } : null
}
function saveCnCv(cn, cv) { localStorage.setItem('ed_cn', cn); localStorage.setItem('ed_cv', cv) }
function loadCnCv() { return { cn: localStorage.getItem('ed_cn'), cv: localStorage.getItem('ed_cv') } }
function clearStorage() { ['ed_u','ed_p','ed_cn','ed_cv'].forEach(k => localStorage.removeItem(k)) }

// ── API ────────────────────────────────────────────────────────────────────
async function apiPost(path, bodyObj, extraHeaders = {}) {
  const res = await fetch(`${PROXY}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', ...extraHeaders },
    body: 'data=' + JSON.stringify(bodyObj)
  })
  const token = res.headers.get('x-token')
  if (token) xToken = token
  const text = await res.text()
  try { return JSON.parse(text) }
  catch(e) { throw new Error('Réponse non-JSON : ' + text.slice(0, 100)) }
}

// ── Whitelist ──────────────────────────────────────────────────────────────
async function whitelist(mot) {
  const response = await fetch("whitelist.txt")
  const contenu = await response.text()
  return contenu.split("\n").map(l => l.trim()).includes(mot)
}

// ── Login ──────────────────────────────────────────────────────────────────
async function login(username, password) {
  showLoading('Connexion…', username)
  $('login-error').style.display = 'none'
  try {
    const whitelisted = await whitelist(username)
    if (!whitelisted) throw new Error("Accès interdit")
    const { cn, cv } = loadCnCv()
    const bodyData = cn && cv
      ? { identifiant: username, motdepasse: password, isRelogin: false, cn, cv, uuid: '', fa: [{ cn, cv }] }
      : { identifiant: username, motdepasse: password, isRelogin: false }

    const json = await apiPost(`/v3/login.awp?v=${API_VERSION}`, bodyData)

    if (json.code === 505) throw new Error('Identifiants invalides')
    if (json.code !== 200 && json.code !== 250) throw new Error(`Erreur API ${json.code}`)

    saveCredentials(username, password)

    if (json.code === 250) {
      mfaCredentials = { username, password }
      await showMfa()
      return
    }

    const acc = json.data?.accounts?.[0]
    await loadGrades(acc?.id, acc ? `${acc.prenom} ${acc.nom}`.trim() : '')

  } catch(e) { showScreen('login'); showError(e.message) }
}

// ── MFA ────────────────────────────────────────────────────────────────────
async function showMfa() {
  try {
    const headers = xToken ? { 'x-token': xToken } : {}
    const json = await apiPost(`/v3/connexion/doubleauth.awp?verbe=get&v=${API_VERSION}`, {}, headers)
    if (!json.data) throw new Error('Réponse MFA invalide')

    $('mfa-question-text').textContent = atob(json.data.question)
    const options = json.data.propositions.map(p => atob(p))
    const container = $('mfa-options')
    container.innerHTML = ''
    let selectedAnswer = null

    options.forEach(opt => {
      const el = document.createElement('div')
      el.className = 'mfa-option'
      el.innerHTML = `<div class="mfa-radio"></div><span>${opt}</span>`
      el.addEventListener('click', () => {
        container.querySelectorAll('.mfa-option').forEach(o => o.classList.remove('selected'))
        el.classList.add('selected')
        selectedAnswer = opt
        $('btn-mfa').disabled = false
      })
      container.appendChild(el)
    })

    $('btn-mfa').onclick = async () => {
      if (!selectedAnswer) return
      showLoading('Vérification MFA…')
      try {
        const h2 = xToken ? { 'x-token': xToken } : {}
        const res = await apiPost(`/v3/connexion/doubleauth.awp?verbe=post&v=${API_VERSION}`, { choix: btoa(selectedAnswer) }, h2)
        const cn = res.data?.cn, cv = res.data?.cv
        if (!cn || !cv) throw new Error('Device tokens absents')
        saveCnCv(cn, cv)

        const bodyData = { identifiant: mfaCredentials.username, motdepasse: mfaCredentials.password, isRelogin: false, cn, cv, uuid: '', fa: [{ cn, cv }] }
        const json2 = await apiPost(`/v3/login.awp?v=${API_VERSION}`, bodyData)
        if (json2.code !== 200) throw new Error('Re-login échoué après MFA')
        const acc = json2.data?.accounts?.[0]
        await loadGrades(acc?.id, acc ? `${acc.prenom} ${acc.nom}`.trim() : '')
      } catch(e) { showScreen('login'); showError(e.message) }
    }

    showScreen('mfa')
  } catch(e) { showScreen('login'); showError('Erreur MFA : ' + e.message) }
}

// ── Notes ──────────────────────────────────────────────────────────────────
async function loadGrades(studentId, studentName) {
  showLoading('Chargement des notes…', studentName);

  try {
    const headers = xToken ? { 'x-token': xToken } : {};
    let json = "";

    const r = await fetch("./notes.json", { method: "HEAD" });

    if (r.ok) {
      const res = await fetch("./notes.json");
      const text = await res.text();
      json = JSON.parse(text);
    } else {
      json = await apiPost(
        `/v3/eleves/${studentId}/notes.awp?verbe=get&v=${API_VERSION}`,
        { token: xToken },
        headers
      );
    }

    if (json.code !== 200) {
      throw new Error(`Erreur notes ${json.code}`);
    }
    
    console.log(json);

    renderGrades(studentName, parseGrades(json.data));

  } catch (e) {
    showScreen('login');
    showError('Erreur notes : ' + e.message);
  }
}

function pf(s) {
  if (s === null || s === undefined || s === '') return null
  const n = parseFloat(String(s).replace(',', '.'))
  return isNaN(n) ? null : n
}

function round2(n) {
  return n !== null ? Number(Math.round((n + Number.EPSILON) * 100) / 100) : null
}

function calcWeightedAvg(grades) {
  const valid = grades.filter(g => g.normalized !== null && !g.nonSignificatif)
  const totalCoef = valid.reduce((s, g) => s + g.coef, 0)
  return totalCoef > 0 ? valid.reduce((s, g) => s + g.normalized * g.coef, 0) / totalCoef : null
}

function calcWeightedClassAvg(grades) {
  const valid = grades.filter(g => g.classAvg !== null && g.outOf > 0 && !g.nonSignificatif)
  const totalCoef = valid.reduce((s, g) => s + g.coef, 0)
  return totalCoef > 0 ? valid.reduce((s, g) => s + (g.classAvg / g.outOf) * 20 * g.coef, 0) / totalCoef : null
}

function calcGroupAvg(subjects) {
  const valid = subjects.filter(s => s.average !== null)

  const totalCoef = valid.reduce((s, subj) => s + subj.coefMatiere, 0)

  if (totalCoef <= 0) return null

  return round2(
    valid.reduce((s, subj) => s + subj.average * subj.coefMatiere, 0) / totalCoef
  )
}

function parseGrades(data) {
  const notes = data.notes || []
  const periodes = (data.periodes || []).filter(p =>
    !p.annuel && p.codePeriode && ['A001','A002','A003'].includes(p.codePeriode)
  )

  const allGrades = notes.map(n => {
    const value = pf(n.valeur), outOf = pf(n.noteSur) ?? 20, coef = pf(n.coef) ?? 1
    const rawVal = String(n.valeur || '').trim()
    const isDispensed = rawVal !== '' && value === null
    return {
      name: n.devoir || '', value, outOf, coef,
      subject: n.libelleMatiere || '?',
      codeMatiere: n.codeMatiere || '',
      period: n.codePeriode || '',
      date: n.date || '',
      classAvg: pf(n.moyenneClasse),
      nonSignificatif: n.nonSignificatif || false,
      isDispensed,
      rawVal,
      normalized: value !== null && outOf > 0 ? (value / outOf) * 20 : null
    }
  })

  return periodes.sort((a, b) => a.codePeriode.localeCompare(b.codePeriode)).map(p => {
    const pg = allGrades.filter(g => g.period === p.codePeriode)

    const disciplines = p.ensembleMatieres?.disciplines || []
    const groupes = disciplines.filter(d => d.groupeMatiere)
    const idTronc = groupes.find(g => g.discipline === 'TRONC COMMUN')?.id
    const idOpt   = groupes.find(g => g.discipline === 'OPTIONS')?.id

    const codesTC  = new Set(disciplines.filter(d => !d.groupeMatiere && d.idGroupeMatiere === idTronc).map(d => d.codeMatiere))
    const codesOpt = new Set(disciplines.filter(d => !d.groupeMatiere && d.idGroupeMatiere === idOpt).map(d => d.codeMatiere))

    const allSubjectsFromED = disciplines.filter(d => !d.groupeMatiere)

    const grouped = {}

    allSubjectsFromED.forEach(d => {
      const grades = pg.filter(g => g.codeMatiere === d.codeMatiere)

      const coefMatiere = pf(d.coef) ?? 1
      const average = round2(calcWeightedAvg(grades))
      const classAverage = calcWeightedClassAvg(grades)

      const hasValidGrade = grades.some(g =>
        g.value !== null && !g.isDispensed && !g.nonSignificatif
      )

      const subject = {
        name: d.libelle || d.discipline || d.codeMatiere,
        codeMatiere: d.codeMatiere,
        coefMatiere,
        average,
        classAverage,
        grades: grades.sort((a, b) => a.date.localeCompare(b.date)),
        noAverage: average === null || !hasValidGrade
      }

      const key = coefMatiere
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(subject)
    })

    const subjects = Object.keys(grouped)
      .sort((a, b) => Number(b) - Number(a)) // coef décroissant
      .flatMap(coef => {
        return grouped[coef].sort((a, b) => {
          // 1) avec moyenne avant sans moyenne
          if (a.average === null && b.average !== null) return 1
          if (a.average !== null && b.average === null) return -1

          // 2) tri par moyenne décroissante
          if (a.average !== null && b.average !== null) {
            return b.average - a.average
          }

          // 3) fallback nom
          return a.name.localeCompare(b.name)
        })
      })

    const tc  = subjects.filter(s => codesTC.has(s.codeMatiere))
    const opt = subjects.filter(s => codesOpt.has(s.codeMatiere))

    const edTcMoy  = round2(pf(disciplines.find(d => d.groupeMatiere && d.discipline === 'TRONC COMMUN')?.moyenne))
    const edOptMoy = round2(pf(disciplines.find(d => d.groupeMatiere && d.discipline === 'OPTIONS')?.moyenne))

    const tcAverage  = calcGroupAvg(tc)
    const optAverage = calcGroupAvg(opt)

    return {
      periodId: p.codePeriode,
      label: p.periode || p.codePeriode,
      isClosed: p.cloture,
      generalAverage: calcGroupAvg(subjects),
      tcAverage,
      optAverage,
      tcDiffers:  tcAverage  !== null && edTcMoy  !== null && tcAverage  !== edTcMoy,
      optDiffers: optAverage !== null && edOptMoy !== null && optAverage !== edOptMoy,
      edTcMoy,
      edOptMoy,
      subjects,
      tc,
      opt
    }
  })
}
                             
