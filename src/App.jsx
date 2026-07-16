import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import logoImage from '../logo.png'
import visionMissionImage from '../our-vision-mission.png'
import departmentVisionMissionImage from '../vision-mission-transparent-v2.png'
import subjectWiseReportTemplateUrl from '../subject-wise-report-template.xlsx?url'
import './App.css'

const menuItems = [
  { icon: '\u{1F3E0}', label: 'Dashboard', metric: 'Overview' },
  { icon: '\u{1F393}', label: 'Departments', metric: '12 active' },
  { icon: '\u{1F441}', label: 'Department Vision and Mission', metric: 'Department direction' },
  { icon: '\u{1F4DA}', label: 'Programmes', metric: '28 mapped' },
  { icon: '\u{1F4C5}', label: 'Admission Batch Management', metric: 'Admission batches' },
  { icon: '\u{1F5D3}', label: 'Semester', metric: 'Academic terms' },
  { icon: '\u{1F4D6}', label: 'Courses', metric: '412 courses' },
  { icon: '\u{1F4DD}', label: 'Set Target', metric: '96 planned' },
  { icon: '\u{1F3AF}', label: 'Course Outcomes', metric: '1,846 COs' },
  { icon: '\u{1F3C6}', label: 'PO/PSO/PEO', metric: 'NBA aligned' },
  { icon: '\u{1F517}', label: 'CO-PO Mapping', metric: '78% complete' },
  { icon: '\u{1F4CB}', label: 'University Mapping Question', metric: 'External exam' },
  { icon: '\u{1F4E4}', label: 'External Mark Upload', metric: 'External marks' },
  { icon: '\u{1F4E5}', label: 'Internal Mark Upload', metric: 'Internal marks' },
  {
    icon: '\u{1F4CA}',
    label: 'Attainment',
    metric: 'Outcome analysis',
    children: [
      { icon: '\u{1F9E9}', label: 'Articulation Matrix', metric: 'Matrix' },
      { icon: '\u{1F4DD}', label: 'Mark Attainment', metric: 'Marks' },
      { icon: '\u{1F4CA}', label: 'CO Attainment Calculation', metric: 'Current cycle' },
      { icon: '\u{1F517}', label: 'CO-PO Attainment', metric: 'PO linked' },
      { icon: '\u{1F3AF}', label: 'CO-PSO Attainment', metric: 'PSO linked' },
    ],
  },
  {
    icon: '\u{1F468}\u200D\u{1F3EB}',
    label: 'Faculty',
    metric: '148 users',
    children: [
      { icon: '\u2795', label: 'Add Faculty', metric: 'New faculty' },
      { icon: '\u{1F4E5}', label: 'Import Faculty', metric: 'Bulk import' },
    ],
  },
  {
    icon: '\u{1F468}\u200D\u{1F393}',
    label: 'Students',
    metric: '4,820 records',
    children: [
      { icon: '\u{1F4E5}', label: 'Import Student', metric: 'Bulk import' },
      { icon: '\u{1F517}', label: 'Student Course Faculty Mapping', metric: 'Course mapping' },
    ],
  },
  {
    icon: '\u{1F4C4}',
    label: 'Report',
    metric: 'Reports',
    children: [
      { icon: '\u{1F3EB}', label: 'All Departments', metric: 'All students' },
      { icon: '\u{1F500}', label: 'Department Wise', metric: 'By department' },
      { icon: '\u{1F4D6}', label: 'Course Wise', metric: 'By course' },
    ],
  },
  {
    icon: '\u2699',
    label: 'Settings',
    metric: 'Admin',
    children: [
      { icon: '\u{1F510}', label: 'Faculty Login Mapping', metric: 'Login access' },
      { icon: '\u{1F6E1}', label: 'Faculty Permission Management', metric: 'Permissions' },
      { icon: '\u{1F4DA}', label: 'Assigned Courses', metric: 'Faculty courses' },
    ],
  },
]

const flatMenuItems = menuItems.flatMap((item) => [item, ...(item.children || [])])
const allMenuLabels = flatMenuItems.map((item) => item.label)

function expandAllowedModules(allowedModules) {
  const allowed = new Set(allowedModules || [])

  if (allowed.has('PO / PSO')) {
    allowed.add('PO/PSO/PEO')
  }

  menuItems.forEach((item) => {
    if (item.children?.length && allowed.has(item.label)) {
      item.children.forEach((child) => allowed.add(child.label))
    }
  })

  return allowed
}

function filterMenuItemsByModules(items, allowedModules) {
  if (!allowedModules?.length) {
    return []
  }

  const allowed = expandAllowedModules(allowedModules)

  return items
    .map((item) => {
      const children = item.children?.filter((child) => allowed.has(child.label)) || []

      if (!allowed.has(item.label) && !children.length) {
        return null
      }

      return {
        ...item,
        children: item.children ? children : undefined,
      }
    })
    .filter(Boolean)
}

function menuHash(label) {
  return `#${label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\s*\/\s*/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')}`
}

function normalizeHashRoute(hash) {
  const normalizedHash = String(hash || '').toLowerCase()

  if (['#po-pso', '#po/pso', '#po-/-pso', '#po-and-pso', '#po-pso-management', '#po-pso-peo-management'].includes(normalizedHash)) {
    return '#po-pso-peo'
  }

  return normalizedHash
}

function activeItemFromHash() {
  if (typeof window === 'undefined') {
    return menuItems[0].label
  }

  const activeHash = normalizeHashRoute(window.location.hash)
  const matchedItem = flatMenuItems.find((item) => menuHash(item.label) === activeHash)

  return matchedItem?.label || menuItems[0].label
}

const emptyDepartment = {
  department_name: '',
  department_code: '',
  institute_college: 'ABIT',
  hod: '',
  email: '',
  phone: '',
  status: 'Active',
}

const emptyProgramme = {
  department_id: '',
  programme_name: '',
  programme_code: '',
  programme_type: 'UG',
  duration_years: '4',
  total_semesters: '8',
  accreditation_status: 'Accredited',
  status: 'Active',
}

const emptySemester = {
  department_id: '',
  programme_id: '',
  admission_batch_id: '',
  admission_year: '',
  semester_number: '1',
  semester_name: '1st Semester',
  academic_year: '',
  status: 'Active',
}

const emptyCourse = {
  department_id: '',
  programme_id: '',
  semester_id: '',
  course_code: '',
  course_name: '',
  course_type: 'Theory',
  credits: '4',
  lecture_hours: '3',
  tutorial_hours: '1',
  practical_hours: '0',
  total_marks: '100',
  status: 'Active',
}

const emptyCourseOutcome = {
  department_id: '',
  programme_id: '',
  semester_id: '',
  course_id: '',
  co_code: 'CO1',
  co_statement: '',
  bloom_level: 'Understand',
  target_level: '2.50',
  status: 'Active',
}

const coCodeOptions = ['CO1', 'CO2', 'CO3', 'CO4', 'CO5', 'CO6']

const emptyProgrammeOutcome = {
  code: '',
  title: '',
  statement: '',
  status: 'Active',
}

const bloomLevels = [
  'Remember',
  'Understand',
  'Apply',
  'Analyze',
  'Evaluate',
  'Create',
]

const defaultAssessmentLevels = [
  {
    level_number: 1,
    code: 'LL',
    level_name: 'Low Level',
    min_percentage: '0',
    max_percentage: '59.99',
    condition_text: '<60% target marks',
  },
  {
    level_number: 2,
    code: 'ML',
    level_name: 'Medium Level',
    min_percentage: '60',
    max_percentage: '69.99',
    condition_text: '60% to 69% target',
  },
  {
    level_number: 3,
    code: 'HL',
    level_name: 'High Level',
    min_percentage: '70',
    max_percentage: '100',
    condition_text: '>=70% target marks',
  },
]

const academicYears = ['2026-27', '2025-26', '2024-25', '2023-24']
const targetAcademicYears = Array.from({ length: 11 }, (_item, index) => {
  const startYear = 2023 + index
  return `${startYear}-${String(startYear + 1).slice(-2)}`
})
const assessmentCategories = [
  'Internal & External Assessment',
  'Internal Assessment',
  'External Assessment',
]

function getSemesterName(semesterNumber) {
  const suffixes = { 1: 'st', 2: 'nd', 3: 'rd' }
  const suffix = suffixes[Number(semesterNumber)] || 'th'
  return `${semesterNumber}${suffix} Semester`
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function getSheetValue(row, names) {
  const matchedKey = Object.keys(row).find((key) =>
    names.includes(normalizeHeader(key)),
  )

  return matchedKey ? row[matchedKey] : ''
}

function normalizeOutcomeCode(type, value) {
  const prefix = type === 'PSO' ? 'PSO' : type === 'PEO' ? 'PEO' : 'PO'
  const code = String(value || '').trim().toUpperCase().replace(/\s+/g, '')

  if (!code) {
    return ''
  }

  if (/^\d+$/.test(code)) {
    return `${prefix}${code}`
  }

  return code.startsWith(prefix) ? code : `${prefix}${code.replace(/^(PSO|PEO|PO)/, '')}`
}

function gradeToPercentMark(value) {
  const grade = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')

  const gradeScale = {
    O: 100,
    E: 80,
    A: 70,
    B: 60,
    C: 50,
    D: 40,
    F: 30,
    'F(EX)': 30,
    FEX: 30,
    S: 0,
    ABSENT: 0,
  }

  if (grade.startsWith('F(EX)') || grade.startsWith('FEX')) {
    return 30
  }

  if (grade === 'S' || grade.startsWith('S[') || grade.includes('ABSENT')) {
    return 0
  }

  return gradeScale[grade]
}

function normalizeGradeForDisplay(value) {
  const grade = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')

  if (!grade) {
    return ''
  }

  if (grade.startsWith('F(EX)') || grade.startsWith('FEX') || grade === 'F') {
    return 'F(Ex)'
  }

  if (grade === 'S' || grade.startsWith('S[') || grade.includes('ABSENT')) {
    return 'S'
  }

  return grade
}

function sgpaToGrade(value) {
  const sgpa = Number(value)

  if (!Number.isFinite(sgpa)) {
    return ''
  }

  if (sgpa >= 9) return 'O'
  if (sgpa >= 8) return 'E'
  if (sgpa >= 7) return 'A'
  if (sgpa >= 6) return 'B'
  if (sgpa >= 5) return 'C'
  if (sgpa >= 4) return 'D'
  if (sgpa > 0) return 'F(Ex)'
  return 'S'
}

function sgpaToPercentMark(value) {
  return gradeToPercentMark(sgpaToGrade(value))
}

async function readResponseJson(response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    const contentType = response.headers.get('content-type') || ''

    if (contentType.includes('text/html') || text.trim().startsWith('<!DOCTYPE')) {
      return {
        error:
          'API server is not returning JSON. Start the app with npm run dev, then refresh the page.',
      }
    }

    return {
      error: 'API server returned an invalid response. Please try again.',
    }
  }
}

function LoginPage({ onLogin }) {
  const [formData, setFormData] = useState({
    email: 'admin@abit.edu.in',
    password: 'admin123',
  })
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  function updateLoginField(event) {
    const { name, value } = event.target
    setFormData((current) => ({ ...current, [name]: value }))
    setMessage('')
  }

  async function submitLogin(event) {
    event.preventDefault()
    setIsLoading(true)
    setMessage('')

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to login.')
      }

      onLogin(data)
    } catch (loginError) {
      setMessage(loginError.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero" aria-label="OBE Management System Login">
        <form className="login-card" onSubmit={submitLogin}>
          <img className="login-avatar" src={logoImage} alt="ABIT logo" />
          <div className="login-heading">
            <h1>User Log in</h1>
          </div>
          <label className="login-field">
            <input
              name="email"
              type="email"
              value={formData.email}
              onChange={updateLoginField}
              placeholder="User ID"
            />
            <span className="login-input-icon" aria-hidden="true">
              &#128100;
            </span>
          </label>
          <label className="login-field">
            <input
              name="password"
              type="password"
              value={formData.password}
              onChange={updateLoginField}
              placeholder="Password"
            />
            <span className="login-input-icon" aria-hidden="true">
              &#128273;
            </span>
          </label>
          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? 'LOGGING IN...' : 'LOGIN'}
          </button>
          <p className="login-copyright">
            Copyright © 2026{' '}
            <a href="https://abit.edu.in/" target="_blank" rel="noreferrer">
              ABIT Group of Institutions
            </a>
            . All rights reserved.
          </p>
          {message && <div className="login-error">{message}</div>}
        </form>
      </section>
    </main>
  )
}

function DepartmentsPage() {
  const [departments, setDepartments] = useState([])
  const [formData, setFormData] = useState(emptyDepartment)
  const [editingId, setEditingId] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [showForm, setShowForm] = useState(false)

  async function loadDepartments() {
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/departments')
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to load departments.')
      }

      setDepartments(data || [])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDepartments()
  }, [])

  function updateField(event) {
    const { name, value } = event.target
    setFormData((current) => ({ ...current, [name]: value }))
  }

  function resetForm() {
    setEditingId(null)
    setFormData(emptyDepartment)
    setShowForm(false)
    setMessage('')
    setError('')
  }

  function openAddForm() {
    setEditingId(null)
    setFormData(emptyDepartment)
    setShowForm(true)
    setMessage('')
    setError('')
  }

  function editDepartment(department) {
    setEditingId(department.department_id)
    setFormData({
      department_name: department.department_name || '',
      department_code: department.department_code || '',
      institute_college: department.institute_college || '',
      hod: department.hod || '',
      email: department.email || '',
      phone: department.phone || '',
      status: department.status || 'Active',
    })
    setShowForm(true)
    setMessage('')
    setError('')
  }

  async function saveDepartment(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    const url = editingId ? `/api/departments/${editingId}` : '/api/departments'
    const method = editingId ? 'PUT' : 'POST'

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save department.')
      }

      const successMessage = editingId ? 'Department updated.' : 'Department saved.'
      resetForm()
      setMessage(successMessage)
      await loadDepartments()
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function deleteDepartment(departmentId) {
    setError('')
    setMessage('')

    try {
      const response = await fetch(`/api/departments/${departmentId}`, {
        method: 'DELETE',
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to delete department.')
      }

      if (editingId === departmentId) {
        resetForm()
      }

      setMessage('Department deleted.')
      await loadDepartments()
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  return (
    <section className="department-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Department Management</p>
          <h3>Departments</h3>
        </div>
        <button type="button" className="action-button" onClick={openAddForm}>
          + Add New Department
        </button>
      </div>

      {showForm && (
        <form className="department-form" onSubmit={saveDepartment}>
          <div className="form-heading">
            <h4>Add / Edit Department</h4>
            <span>{editingId ? `Editing #${editingId}` : 'New record'}</span>
          </div>

          <label>
            <span>Department Name</span>
            <input
              name="department_name"
              value={formData.department_name}
              onChange={updateField}
              placeholder="Computer Science Engineering"
              required
            />
          </label>

          <label>
            <span>Department Code</span>
            <input
              name="department_code"
              value={formData.department_code}
              onChange={updateField}
              placeholder="CSE"
              required
            />
          </label>

          <label>
            <span>Institute / College</span>
            <input
              name="institute_college"
              value={formData.institute_college}
              onChange={updateField}
              placeholder="ABIT"
            />
          </label>

          <label>
            <span>Head of Department</span>
            <input
              name="hod"
              value={formData.hod}
              onChange={updateField}
              placeholder="Dr. ABC"
            />
          </label>

          <label>
            <span>Email ID</span>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={updateField}
              placeholder="hodcse@college.edu"
            />
          </label>

          <label>
            <span>Phone Number</span>
            <input
              name="phone"
              value={formData.phone}
              onChange={updateField}
              placeholder="Phone number"
            />
          </label>

          <label>
            <span>Status</span>
            <select name="status" value={formData.status} onChange={updateField}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>

          <div className="form-actions">
            <button type="submit" className="save-button">
              Save Department
            </button>
            <button type="button" className="reset-button" onClick={resetForm}>
              Reset
            </button>
          </div>
        </form>
      )}

      {message && <div className="notice success">{message}</div>}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Department List</h4>
          <span>{isLoading ? 'Loading...' : `${departments.length} records`}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sl.No</th>
                <th>Dept Code</th>
                <th>Department Name</th>
                <th>HOD</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((department, index) => (
                <tr key={department.department_id}>
                  <td>{index + 1}</td>
                  <td>{department.department_code}</td>
                  <td>{department.department_name}</td>
                  <td>{department.hod || '-'}</td>
                  <td>
                    <span className={`status-pill ${department.status?.toLowerCase()}`}>
                      {department.status || 'Active'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => editDepartment(department)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteDepartment(department.department_id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!departments.length && !isLoading && (
                <tr>
                  <td colSpan="6" className="empty-cell">
                    No departments found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function ProgrammesPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [formData, setFormData] = useState(emptyProgramme)
  const [editingId, setEditingId] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)

  async function loadDepartments() {
    const response = await fetch('/api/departments')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load departments.')
    }

    setDepartments(data || [])
  }

  async function loadProgrammes() {
    const response = await fetch('/api/programmes')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load programmes.')
    }

    setProgrammes(data || [])
  }

  async function refreshProgrammePage() {
    setIsLoading(true)
    setError('')

    try {
      await Promise.all([loadDepartments(), loadProgrammes()])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshProgrammePage()
  }, [])

  function updateField(event) {
    const { name, value } = event.target
    setFormData((current) => ({ ...current, [name]: value }))
  }

  function resetForm() {
    setEditingId(null)
    setFormData(emptyProgramme)
    setShowForm(false)
    setMessage('')
    setError('')
  }

  function openAddForm() {
    setEditingId(null)
    setFormData(emptyProgramme)
    setShowForm(true)
    setMessage('')
    setError('')
  }

  function editProgramme(programme) {
    setEditingId(programme.programme_id)
    setFormData({
      department_id: programme.department_id ? String(programme.department_id) : '',
      programme_name: programme.programme_name || '',
      programme_code: programme.programme_code || '',
      programme_type: programme.programme_type || 'UG',
      duration_years: programme.duration_years ? String(programme.duration_years) : '4',
      total_semesters: programme.total_semesters ? String(programme.total_semesters) : '8',
      accreditation_status: programme.accreditation_status || 'Accredited',
      status: programme.status || 'Active',
    })
    setShowForm(true)
    setMessage('')
    setError('')
  }

  async function saveProgramme(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    const url = editingId ? `/api/programmes/${editingId}` : '/api/programmes'
    const method = editingId ? 'PUT' : 'POST'

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          department_id: Number(formData.department_id),
          duration_years: Number(formData.duration_years),
          total_semesters: Number(formData.total_semesters),
        }),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save programme.')
      }

      setMessage(editingId ? 'Programme updated.' : 'Programme saved.')
      setEditingId(null)
      setFormData(emptyProgramme)
      setShowForm(false)
      await loadProgrammes()
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function deleteProgramme(programmeId) {
    setError('')
    setMessage('')

    try {
      const response = await fetch(`/api/programmes/${programmeId}`, {
        method: 'DELETE',
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to delete programme.')
      }

      if (editingId === programmeId) {
        resetForm()
      }

      setMessage('Programme deleted.')
      await loadProgrammes()
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  return (
    <section className="department-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Programme Management</p>
          <h3>Programmes</h3>
        </div>
        <button type="button" className="action-button" onClick={openAddForm}>
          + Add New Programme
        </button>
      </div>

      {showForm && (
        <form className="department-form" onSubmit={saveProgramme}>
          <div className="form-heading">
            <h4>Add / Edit Programme</h4>
            <span>{editingId ? `Editing #${editingId}` : 'New record'}</span>
          </div>

          <label>
            <span>Department</span>
            <select
              name="department_id"
              value={formData.department_id}
              onChange={updateField}
              required
            >
              <option value="">Select Department</option>
              {departments.map((department) => (
                <option
                  key={department.department_id}
                  value={department.department_id}
                >
                  {department.department_name} ({department.department_code})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Programme Name</span>
            <input
              name="programme_name"
              value={formData.programme_name}
              onChange={updateField}
              placeholder="B.Tech Computer Science Engineering"
              required
            />
          </label>

          <label>
            <span>Programme Code</span>
            <input
              name="programme_code"
              value={formData.programme_code}
              onChange={updateField}
              placeholder="BTECH-CSE"
              required
            />
          </label>

          <label>
            <span>Programme Type</span>
            <select
              name="programme_type"
              value={formData.programme_type}
              onChange={updateField}
            >
              <option>UG</option>
              <option>PG</option>
              <option>Diploma</option>
            </select>
          </label>

          <label>
            <span>Duration Years</span>
            <input
              type="number"
              min="1"
              name="duration_years"
              value={formData.duration_years}
              onChange={updateField}
              required
            />
          </label>

          <label>
            <span>Total Semesters</span>
            <input
              type="number"
              min="1"
              name="total_semesters"
              value={formData.total_semesters}
              onChange={updateField}
              required
            />
          </label>

          <label>
            <span>NBA / NAAC Status</span>
            <select
              name="accreditation_status"
              value={formData.accreditation_status}
              onChange={updateField}
            >
              <option>Accredited</option>
              <option>Not Accredited</option>
              <option>Applied</option>
            </select>
          </label>

          <label>
            <span>Status</span>
            <select name="status" value={formData.status} onChange={updateField}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>

          <div className="form-actions">
            <button type="submit" className="save-button">
              Save Programme
            </button>
            <button type="button" className="reset-button" onClick={resetForm}>
              Reset
            </button>
          </div>
        </form>
      )}

      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Programme List</h4>
          <span>{isLoading ? 'Loading...' : `${programmes.length} records`}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sl.No</th>
                <th>Department</th>
                <th>Programme Code</th>
                <th>Programme Name</th>
                <th>Duration</th>
                <th>Semesters</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {programmes.map((programme, index) => (
                <tr key={programme.programme_id}>
                  <td>{index + 1}</td>
                  <td>{programme.department_code || '-'}</td>
                  <td>{programme.programme_code}</td>
                  <td>{programme.programme_name}</td>
                  <td>{programme.duration_years} Years</td>
                  <td>{programme.total_semesters}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => editProgramme(programme)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteProgramme(programme.programme_id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!programmes.length && !isLoading && (
                <tr>
                  <td colSpan="7" className="empty-cell">
                    No programmes found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function AdmissionBatchManagementPage() {
  const initialForm = { department_id: '', programme_id: '', starting_academic_year: '2024-25', admission_year: '2024', status: 'Active' }
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [batches, setBatches] = useState([])
  const [form, setForm] = useState(initialForm)
  const [isFormVisible, setIsFormVisible] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const filteredProgrammes = programmes.filter((row) => String(row.department_id) === form.department_id && row.status !== 'Inactive')
  const selectedProgramme = programmes.find((row) => String(row.programme_id) === form.programme_id)
  const durationYears = Number(selectedProgramme?.duration_years || 0)
  const totalSemesters = Number(selectedProgramme?.total_semesters || 0)
  const admissionYear = Number(form.admission_year || 0)
  const completionYear = admissionYear && durationYears ? admissionYear + durationYears : ''
  const batchCode = completionYear ? `${admissionYear}-${String(completionYear).slice(-2)}` : ''
  const admissionYears = Array.from({ length: 11 }, (_, index) => String(2020 + index))
  const startingAcademicYears = Array.from({ length: 11 }, (_, index) => {
    const startYear = 2023 + index
    return `${startYear}-${String(startYear + 1).slice(-2)}`
  })
  const sortedBatches = useMemo(
    () => [...batches].sort((first, second) =>
      Number(second.admission_year) - Number(first.admission_year) ||
      Number(second.admission_batch_id) - Number(first.admission_batch_id)),
    [batches],
  )

  async function loadData() {
    try {
      const responses = await Promise.all(['/api/departments', '/api/programmes', '/api/admission-batches'].map((url) => fetch(url)))
      const data = await Promise.all(responses.map(readResponseJson))
      responses.forEach((response, index) => { if (!response.ok) throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load admission batch data.') })
      setDepartments(data[0] || [])
      setProgrammes(data[1] || [])
      setBatches(data[2] || [])
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  useEffect(() => { loadData() }, [])

  function updateForm(event) {
    const { name, value } = event.target
    setForm((current) => {
      const next = { ...current, [name]: value }
      if (name === 'department_id') next.programme_id = ''
      if (name === 'starting_academic_year') next.admission_year = value.slice(0, 4)
      return next
    })
    setMessage('')
    setError('')
  }

  function resetForm() {
    setForm(initialForm)
    setEditingId(null)
    setMessage('')
    setError('')
  }

  function semesterPlanRows(row) {
    const startingYear = Number(row.admission_year || 0)
    return Array.from({ length: Number(row.total_semesters || 0) }, (_, index) => {
      const semesterNumber = index + 1
      const studyYear = Math.floor(index / 2) + 1
      const academicStart = startingYear + studyYear - 1
      return {
        semester: `Semester ${semesterNumber}`,
        studyYear: `Year ${studyYear}`,
        term: index % 2 + 1,
        academicYear: `${academicStart}-${String(academicStart + 1).slice(-2)}`,
        status: 'Planned',
      }
    })
  }

  function academicYearWiseSemesters(row) {
    return semesterPlanRows(row).reduce((groups, semester) => {
      const existingGroup = groups.find(([academicYear]) => academicYear === semester.academicYear)
      const semesterNumber = Number(semester.semester.replace(/\D/g, ''))
      const remainderTen = semesterNumber % 10
      const remainderHundred = semesterNumber % 100
      const suffix = remainderHundred >= 11 && remainderHundred <= 13
        ? 'th'
        : remainderTen === 1 ? 'st' : remainderTen === 2 ? 'nd' : remainderTen === 3 ? 'rd' : 'th'
      const semesterName = `${semesterNumber}${suffix} Semester`
      if (existingGroup) existingGroup[1].push(semesterName)
      else groups.push([semester.academicYear, [semesterName]])
      return groups
    }, [])
  }

  function AcademicYearSemesterTable({ row }) {
    return (
      <table className="academic-year-semester-table">
        <thead><tr><th>Academic Year</th><th>Semesters</th></tr></thead>
        <tbody>{academicYearWiseSemesters(row).map(([year, semesterNames]) => (
          <tr key={year}><td>{year}</td><td>{semesterNames.join(', ')}</td></tr>
        ))}</tbody>
      </table>
    )
  }

  async function createBatch() {
    setIsSaving(true)
    setMessage('')
    setError('')
    try {
      if (!form.department_id || !form.programme_id) throw new Error('Select Department and Programme.')
      const response = await fetch('/api/admission-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, admission_batch_id: editingId, department_id: Number(form.department_id), programme_id: Number(form.programme_id), admission_year: Number(form.admission_year) }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to create admission batch.')
      setMessage(data.message)
      await loadData()
      resetForm()
      setIsFormVisible(false)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  function editBatch(row) {
    setForm({
      department_id: String(row.department_id || ''),
      programme_id: String(row.programme_id || ''),
      starting_academic_year: row.starting_academic_year || initialForm.starting_academic_year,
      admission_year: String(row.admission_year || ''),
      status: row.status || 'Active',
    })
    setEditingId(row.admission_batch_id)
    setMessage('')
    setError('')
    setIsFormVisible(true)
  }

  async function deleteBatch(row) {
    if (!window.confirm(`Delete admission batch ${row.batch_code} and its generated semesters?`)) return
    setMessage('')
    setError('')
    try {
      const response = await fetch(`/api/admission-batches/${row.admission_batch_id}`, { method: 'DELETE' })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to delete admission batch.')
      setMessage(data.message)
      await loadData()
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  return (
    <section className="department-page">
      <div className="section-title"><div><p className="eyebrow">Admission Batch Management</p><h3>Admission Batch</h3></div>{!isFormVisible && <button type="button" className="save-button" onClick={() => setIsFormVisible(true)}>+ Add New Admission Batch</button>}</div>
      {isFormVisible && <div className="department-form student-master-form">
        <label><span>Department</span><select name="department_id" value={form.department_id} onChange={updateForm}><option value="">Select Department</option>{departments.map((row) => <option key={row.department_id} value={row.department_id}>{row.department_name}</option>)}</select></label>
        <label><span>Programme</span><select name="programme_id" value={form.programme_id} onChange={updateForm}><option value="">Select Programme</option>{filteredProgrammes.map((row) => <option key={row.programme_id} value={row.programme_id}>{row.programme_name}</option>)}</select></label>
        <label><span>Duration</span><input value={durationYears ? `${durationYears} Years` : ''} readOnly placeholder="Select Programme" /></label>
        <label><span>Total Semesters</span><input value={totalSemesters || ''} readOnly placeholder="Select Programme" /></label>
        <label><span>Starting Academic Year</span><select name="starting_academic_year" value={form.starting_academic_year} onChange={updateForm}>{startingAcademicYears.map((year) => <option key={year}>{year}</option>)}</select></label>
        <label><span>Admission Year</span><select name="admission_year" value={form.admission_year} onChange={updateForm}>{admissionYears.map((year) => <option key={year}>{year}</option>)}</select></label>
        <label><span>Completion Year</span><input value={completionYear} readOnly /></label>
        <label><span>Batch Code</span><input value={batchCode} readOnly /></label>
        <label><span>Status</span><select name="status" value={form.status} onChange={updateForm}><option>Active</option><option>Inactive</option></select></label>
        <div className="form-actions"><button type="button" className="save-button" onClick={createBatch} disabled={isSaving}>{isSaving ? 'Saving...' : editingId ? 'Update Batch and Generate Semesters' : 'Create Batch and Generate Semesters'}</button><button type="button" className="reset-button" onClick={resetForm} disabled={isSaving}>Reset</button></div>
      </div>}
      {isFormVisible && (message || error) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || message}</div>}
      <div className="table-panel admission-batches-panel"><div className="table-heading"><h4>Admission Batches</h4><span>{batches.length} records</span></div><div className="table-wrap"><table><thead><tr><th>Admission Year</th><th>Department</th><th>Programme</th><th>Starting Academic Year</th><th>Academic Year</th><th>Semesters</th><th>Duration</th><th>Total Semesters</th><th>Status</th><th>Actions</th></tr></thead><tbody>{sortedBatches.map((row) => { const yearGroups = academicYearWiseSemesters(row); return <tr key={row.admission_batch_id}><td><strong>{row.admission_year}</strong></td><td>{row.department_name}</td><td>{row.programme_name}</td><td>{row.starting_academic_year}</td><td className="stacked-year-cell">{yearGroups.map(([year]) => <div className={year === row.starting_academic_year ? 'starting-academic-year-highlight' : ''} key={year}>{year}</div>)}</td><td className="stacked-semester-cell">{yearGroups.map(([year, semesterNames]) => <div className={year === row.starting_academic_year ? 'starting-academic-year-highlight' : ''} key={year}>{semesterNames.join(', ')}</div>)}</td><td>{row.duration_years} Years</td><td>{row.total_semesters}</td><td><span className={`status-pill ${row.status === 'Inactive' ? 'inactive' : ''}`}>{row.status}</span></td><td><div className="table-actions"><button type="button" className="edit-button" onClick={() => editBatch(row)}>Edit</button><button type="button" className="delete-button" onClick={() => deleteBatch(row)}>Delete</button></div></td></tr> })}{!sortedBatches.length && <tr><td colSpan="10" className="empty-cell">No admission batches created.</td></tr>}</tbody></table></div></div>
    </section>
  )
}

function SemestersPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [admissionBatches, setAdmissionBatches] = useState([])
  const [formData, setFormData] = useState(emptySemester)
  const [editingId, setEditingId] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const filteredProgrammes = useMemo(
    () =>
      programmes.filter(
        (programme) => String(programme.department_id) === formData.department_id,
      ),
    [programmes, formData.department_id],
  )
  const filteredAdmissionBatches = useMemo(
    () => admissionBatches.filter((batch) =>
      String(batch.department_id) === formData.department_id &&
      String(batch.programme_id) === formData.programme_id),
    [admissionBatches, formData.department_id, formData.programme_id],
  )
  const academicYearOptions = useMemo(() => {
    const selectedBatch = admissionBatches.find(
      (batch) => String(batch.admission_batch_id) === formData.admission_batch_id,
    )
    const admissionYear = Number(selectedBatch?.admission_year || formData.admission_year)
    const studyYears = Math.ceil(Number(selectedBatch?.total_semesters || 0) / 2)
    if (!admissionYear || !studyYears) return []
    return Array.from({ length: studyYears }, (_, index) => {
      const year = admissionYear + index
      return `${year}-${String(year + 1).slice(-2)}`
    })
  }, [admissionBatches, formData.admission_batch_id, formData.admission_year])
  const semesterNameOptions = useMemo(() => {
    if (!formData.academic_year || !formData.admission_year) return []
    const studyYearIndex = Number(formData.academic_year.slice(0, 4)) - Number(formData.admission_year)
    const firstSemester = studyYearIndex * 2 + 1
    return [firstSemester, firstSemester + 1].map((number) => ({
      number: String(number),
      name: getSemesterName(number),
    }))
  }, [formData.academic_year, formData.admission_year])

  async function loadDepartments() {
    const response = await fetch('/api/departments')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load departments.')
    }

    setDepartments(data || [])
  }

  async function loadProgrammes() {
    const response = await fetch('/api/programmes')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load programmes.')
    }

    setProgrammes(data || [])
  }

  async function loadSemesters() {
    const response = await fetch('/api/semesters')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load semesters.')
    }

    setSemesters(data || [])
  }

  async function loadAdmissionBatches() {
    const response = await fetch('/api/admission-batches')
    const data = await readResponseJson(response)
    if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load admission batches.')
    setAdmissionBatches(data || [])
  }

  async function refreshSemesterPage() {
    setIsLoading(true)
    setError('')

    try {
      await Promise.all([loadDepartments(), loadProgrammes(), loadSemesters(), loadAdmissionBatches()])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshSemesterPage()
  }, [])

  function updateField(event) {
    const { name, value } = event.target

    setFormData((current) => {
      const next = { ...current, [name]: value }

      if (name === 'department_id') {
        next.programme_id = ''
        next.admission_batch_id = ''
        next.admission_year = ''
        next.academic_year = ''
      }

      if (name === 'programme_id') {
        next.admission_batch_id = ''
        next.admission_year = ''
        next.academic_year = ''
      }

      if (name === 'admission_batch_id') {
        const selectedBatch = admissionBatches.find((batch) => String(batch.admission_batch_id) === value)
        next.admission_year = selectedBatch ? String(selectedBatch.admission_year) : ''
        next.academic_year = selectedBatch
          ? `${selectedBatch.admission_year}-${String(Number(selectedBatch.admission_year) + 1).slice(-2)}`
          : ''
        next.semester_number = '1'
        next.semester_name = getSemesterName(1)
      }

      if (name === 'academic_year') {
        const selectedBatch = admissionBatches.find(
          (batch) => String(batch.admission_batch_id) === next.admission_batch_id,
        )
        const studyYearIndex = Number(value.slice(0, 4)) - Number(selectedBatch?.admission_year || next.admission_year)
        const semesterNumber = Math.max(1, studyYearIndex * 2 + 1)
        next.semester_number = String(semesterNumber)
        next.semester_name = getSemesterName(semesterNumber)
      }

      if (name === 'semester_name') {
        next.semester_number = String(Number(value.replace(/\D/g, '')) || 1)
      }

      return next
    })
  }

  function resetForm() {
    setEditingId(null)
    setFormData(emptySemester)
    setShowForm(false)
    setMessage('')
    setError('')
  }

  function openAddForm() {
    setEditingId(null)
    setFormData(emptySemester)
    setShowForm(true)
    setMessage('')
    setError('')
  }

  function editSemester(semester) {
    setEditingId(semester.semester_id)
    setFormData({
      department_id: semester.department_id ? String(semester.department_id) : '',
      programme_id: semester.programme_id ? String(semester.programme_id) : '',
      admission_batch_id: semester.admission_batch_id ? String(semester.admission_batch_id) : '',
      admission_year: semester.admission_year ? String(semester.admission_year) : '',
      semester_number: semester.semester_number ? String(semester.semester_number) : '1',
      semester_name: semester.semester_name || getSemesterName('1'),
      academic_year: semester.academic_year || '2026-27',
      status: semester.status || 'Active',
    })
    setShowForm(true)
    setMessage('')
    setError('')
  }

  async function saveSemester(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    const url = editingId ? `/api/semesters/${editingId}` : '/api/semesters'
    const method = editingId ? 'PUT' : 'POST'

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          department_id: Number(formData.department_id),
          programme_id: Number(formData.programme_id),
          semester_number: Number(formData.semester_number),
        }),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save semester.')
      }

      setMessage(editingId ? 'Semester updated.' : 'Semester saved.')
      setEditingId(null)
      setFormData(emptySemester)
      setShowForm(false)
      await loadSemesters()
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function deleteSemester(semesterId) {
    setError('')
    setMessage('')

    try {
      const response = await fetch(`/api/semesters/${semesterId}`, {
        method: 'DELETE',
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to delete semester.')
      }

      if (editingId === semesterId) {
        resetForm()
      }

      setMessage('Semester deleted.')
      await loadSemesters()
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  return (
    <section className="department-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Semester Management</p>
          <h3>Semester</h3>
        </div>
        <button type="button" className="action-button" onClick={openAddForm}>
          + Add New Semester
        </button>
      </div>

      {showForm && (
        <form className="department-form" onSubmit={saveSemester}>
          <div className="form-heading">
            <h4>Add / Edit Semester</h4>
            <span>{editingId ? `Editing #${editingId}` : 'New record'}</span>
          </div>

          <label>
            <span>Department</span>
            <select
              name="department_id"
              value={formData.department_id}
              onChange={updateField}
              required
            >
              <option value="">Select Department</option>
              {departments.map((department) => (
                <option
                  key={department.department_id}
                  value={department.department_id}
                >
                  {department.department_name} ({department.department_code})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Programme</span>
            <select
              name="programme_id"
              value={formData.programme_id}
              onChange={updateField}
              required
            >
              <option value="">Select Programme</option>
              {filteredProgrammes.map((programme) => (
                <option key={programme.programme_id} value={programme.programme_id}>
                  {programme.programme_name} ({programme.programme_code})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Admission Year</span>
            <select
              name="admission_batch_id"
              value={formData.admission_batch_id}
              onChange={updateField}
              required
            >
              <option value="">Select Admission Year</option>
              {filteredAdmissionBatches.map((batch) => (
                <option key={batch.admission_batch_id} value={batch.admission_batch_id}>
                  {batch.admission_year}
                </option>
              ))}
            </select>
          </label>

          {formData.admission_batch_id && <label>
            <span>Academic Year</span>
            <select
              name="academic_year"
              value={formData.academic_year}
              onChange={updateField}
              required
            >
              <option value="">Select Academic Year</option>
              {academicYearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>}

          {formData.admission_batch_id && <label>
            <span>Semester Name</span>
            <select
              name="semester_name"
              value={formData.semester_name}
              onChange={updateField}
              required
            >
              <option value="">Select Semester Name</option>
              {semesterNameOptions.map((semester) => (
                <option key={semester.number} value={semester.name}>{semester.name}</option>
              ))}
            </select>
          </label>}

          <label>
            <span>Status</span>
            <select name="status" value={formData.status} onChange={updateField}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>

          <div className="form-actions">
            <button type="submit" className="save-button">
              Save Semester
            </button>
            <button type="button" className="reset-button" onClick={resetForm}>
              Reset
            </button>
          </div>
        </form>
      )}

      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Semester List</h4>
          <span>{isLoading ? 'Loading...' : `${semesters.length} records`}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sl.No</th>
                <th>Department</th>
                <th>Programme Code</th>
                <th>Programme Name</th>
                <th>Admission Year</th>
                <th>Academic Year</th>
                <th>Semester</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {semesters.map((semester, index) => (
                <tr key={semester.semester_id}>
                  <td>{index + 1}</td>
                  <td>{semester.department_code || '-'}</td>
                  <td>{semester.programme_code || '-'}</td>
                  <td>{semester.programme_name || '-'}</td>
                  <td>{semester.admission_year || '-'}</td>
                  <td>{semester.academic_year || '-'}</td>
                  <td>Sem {semester.semester_number}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => editSemester(semester)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSemester(semester.semester_id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!semesters.length && !isLoading && (
                <tr>
                  <td colSpan="8" className="empty-cell">
                    No semesters found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function CoursesPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [formData, setFormData] = useState(emptyCourse)
  const [editingId, setEditingId] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [isLoading, setIsLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const filteredProgrammes = useMemo(
    () =>
      programmes.filter(
        (programme) => String(programme.department_id) === formData.department_id,
      ),
    [programmes, formData.department_id],
  )

  const filteredSemesters = useMemo(
    () =>
      semesters.filter(
        (semester) =>
          String(semester.department_id) === formData.department_id &&
          String(semester.programme_id) === formData.programme_id,
      ),
    [semesters, formData.department_id, formData.programme_id],
  )

  async function loadDepartments() {
    const response = await fetch('/api/departments')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load departments.')
    }

    setDepartments(data || [])
  }

  async function loadProgrammes() {
    const response = await fetch('/api/programmes')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load programmes.')
    }

    setProgrammes(data || [])
  }

  async function loadSemesters() {
    const response = await fetch('/api/semesters')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load semesters.')
    }

    setSemesters(data || [])
  }

  async function loadCourses() {
    const response = await fetch('/api/courses')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load courses.')
    }

    setCourses(data || [])
  }

  async function refreshCoursePage() {
    setIsLoading(true)
    setError('')

    try {
      await Promise.all([
        loadDepartments(),
        loadProgrammes(),
        loadSemesters(),
        loadCourses(),
      ])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshCoursePage()
  }, [])

  function updateField(event) {
    const { name, value } = event.target

    setFormData((current) => {
      const next = { ...current, [name]: value }

      if (name === 'department_id') {
        next.programme_id = ''
        next.semester_id = ''
      }

      if (name === 'programme_id') {
        next.semester_id = ''
      }

      return next
    })
  }

  function resetForm() {
    setEditingId(null)
    setFormData(emptyCourse)
    setShowForm(false)
    setMessage('')
    setError('')
  }

  function openAddForm() {
    setEditingId(null)
    setFormData(emptyCourse)
    setShowForm(true)
    setMessage('')
    setError('')
  }

  function editCourse(course) {
    setEditingId(course.course_id)
    setFormData({
      department_id: course.department_id ? String(course.department_id) : '',
      programme_id: course.programme_id ? String(course.programme_id) : '',
      semester_id: course.semester_id ? String(course.semester_id) : '',
      course_code: course.course_code || '',
      course_name: course.course_name || '',
      course_type: course.course_type || 'Theory',
      credits: course.credits ? String(course.credits) : '4',
      lecture_hours: course.lecture_hours ? String(course.lecture_hours) : '3',
      tutorial_hours: course.tutorial_hours ? String(course.tutorial_hours) : '1',
      practical_hours: course.practical_hours ? String(course.practical_hours) : '0',
      total_marks: course.total_marks ? String(course.total_marks) : '100',
      status: course.status || 'Active',
    })
    setShowForm(true)
    setMessage('')
    setError('')
  }

  async function saveCourse(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    const url = editingId ? `/api/courses/${editingId}` : '/api/courses'
    const method = editingId ? 'PUT' : 'POST'

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          department_id: Number(formData.department_id),
          programme_id: Number(formData.programme_id),
          semester_id: Number(formData.semester_id),
          credits: Number(formData.credits),
          lecture_hours: Number(formData.lecture_hours),
          tutorial_hours: Number(formData.tutorial_hours),
          practical_hours: Number(formData.practical_hours),
          total_marks: Number(formData.total_marks),
        }),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save course.')
      }

      setMessage(editingId ? 'Course updated.' : 'Course saved.')
      setEditingId(null)
      setFormData(emptyCourse)
      setShowForm(false)
      await loadCourses()
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function deleteCourse(courseId) {
    setError('')
    setMessage('')

    try {
      const response = await fetch(`/api/courses/${courseId}`, {
        method: 'DELETE',
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to delete course.')
      }

      if (editingId === courseId) {
        resetForm()
      }

      setMessage('Course deleted.')
      await loadCourses()
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  return (
    <section className="department-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Course Management</p>
          <h3>Courses</h3>
        </div>
        <button type="button" className="action-button" onClick={openAddForm}>
          + Add New Course
        </button>
      </div>

      {showForm && (
        <form className="department-form" onSubmit={saveCourse}>
          <div className="form-heading">
            <h4>Add / Edit Course</h4>
            <span>{editingId ? `Editing #${editingId}` : 'New record'}</span>
          </div>

          <label>
            <span>Department</span>
            <select
              name="department_id"
              value={formData.department_id}
              onChange={updateField}
              required
            >
              <option value="">Select Department</option>
              {departments.map((department) => (
                <option key={department.department_id} value={department.department_id}>
                  {department.department_name} ({department.department_code})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Programme</span>
            <select
              name="programme_id"
              value={formData.programme_id}
              onChange={updateField}
              required
            >
              <option value="">Select Programme</option>
              {filteredProgrammes.map((programme) => (
                <option key={programme.programme_id} value={programme.programme_id}>
                  {programme.programme_name} ({programme.programme_code})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Semester</span>
            <select
              name="semester_id"
              value={formData.semester_id}
              onChange={updateField}
              required
            >
              <option value="">Select Semester</option>
              {filteredSemesters.map((semester) => (
                <option key={semester.semester_id} value={semester.semester_id}>
                  {semester.semester_name || `Sem ${semester.semester_number}`}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Course Code</span>
            <input
              name="course_code"
              value={formData.course_code}
              onChange={updateField}
              placeholder="PCC-CS301"
              required
            />
          </label>

          <label>
            <span>Course Name</span>
            <input
              name="course_name"
              value={formData.course_name}
              onChange={updateField}
              placeholder="Data Structures"
              required
            />
          </label>

          <label>
            <span>Course Type</span>
            <select name="course_type" value={formData.course_type} onChange={updateField}>
              <option>Theory</option>
              <option>Practical</option>
              <option>Sessional</option>
              <option>Project</option>
            </select>
          </label>

          <label>
            <span>Credits</span>
            <input type="number" min="0" name="credits" value={formData.credits} onChange={updateField} />
          </label>

          <label>
            <span>Lecture Hours</span>
            <input type="number" min="0" name="lecture_hours" value={formData.lecture_hours} onChange={updateField} />
          </label>

          <label>
            <span>Tutorial Hours</span>
            <input type="number" min="0" name="tutorial_hours" value={formData.tutorial_hours} onChange={updateField} />
          </label>

          <label>
            <span>Practical Hours</span>
            <input type="number" min="0" name="practical_hours" value={formData.practical_hours} onChange={updateField} />
          </label>

          <label>
            <span>Total Marks</span>
            <input type="number" min="0" name="total_marks" value={formData.total_marks} onChange={updateField} />
          </label>

          <label>
            <span>Status</span>
            <select name="status" value={formData.status} onChange={updateField}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>

          <div className="form-actions">
            <button type="submit" className="save-button">
              Save Course
            </button>
            <button type="button" className="reset-button" onClick={resetForm}>
              Reset
            </button>
          </div>
        </form>
      )}

      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Course List</h4>
          <span>{isLoading ? 'Loading...' : `${courses.length} records`}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sl.No</th>
                <th>Dept</th>
                <th>Programme</th>
                <th>Sem</th>
                <th>Course Code</th>
                <th>Course Name</th>
                <th>Credits</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((course, index) => (
                <tr key={course.course_id}>
                  <td>{index + 1}</td>
                  <td>{course.department_code || '-'}</td>
                  <td>{course.programme_code || '-'}</td>
                  <td>{course.semester_number || '-'}</td>
                  <td>{course.course_code}</td>
                  <td>{course.course_name}</td>
                  <td>{course.credits}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => editCourse(course)}>
                        Edit
                      </button>
                      <button type="button" onClick={() => deleteCourse(course.course_id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!courses.length && !isLoading && (
                <tr>
                  <td colSpan="8" className="empty-cell">
                    No courses found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function CourseOutcomesPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [courseOutcomes, setCourseOutcomes] = useState([])
  const [formData, setFormData] = useState(emptyCourseOutcome)
  const [editingId, setEditingId] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const filteredProgrammes = useMemo(
    () =>
      programmes.filter(
        (programme) => String(programme.department_id) === formData.department_id,
      ),
    [programmes, formData.department_id],
  )

  const filteredSemesters = useMemo(
    () =>
      semesters.filter(
        (semester) =>
          String(semester.department_id) === formData.department_id &&
          String(semester.programme_id) === formData.programme_id,
      ),
    [semesters, formData.department_id, formData.programme_id],
  )

  const filteredCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          String(course.department_id) === formData.department_id &&
          String(course.programme_id) === formData.programme_id &&
          String(course.semester_id) === formData.semester_id,
      ),
    [courses, formData.department_id, formData.programme_id, formData.semester_id],
  )

  async function loadDepartments() {
    const response = await fetch('/api/departments')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load departments.')
    }

    setDepartments(data || [])
  }

  async function loadProgrammes() {
    const response = await fetch('/api/programmes')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load programmes.')
    }

    setProgrammes(data || [])
  }

  async function loadSemesters() {
    const response = await fetch('/api/semesters')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load semesters.')
    }

    setSemesters(data || [])
  }

  async function loadCourses() {
    const response = await fetch('/api/courses')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load courses.')
    }

    setCourses(data || [])
  }

  async function loadCourseOutcomes() {
    const response = await fetch('/api/course-outcomes')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load course outcomes.')
    }

    setCourseOutcomes(data || [])
  }

  async function refreshCourseOutcomesPage() {
    setIsLoading(true)
    setError('')

    try {
      await Promise.all([
        loadDepartments(),
        loadProgrammes(),
        loadSemesters(),
        loadCourses(),
        loadCourseOutcomes(),
      ])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshCourseOutcomesPage()
  }, [])

  function updateField(event) {
    const { name, value } = event.target

    setFormData((current) => {
      const next = { ...current, [name]: value }

      if (name === 'department_id') {
        next.programme_id = ''
        next.semester_id = ''
        next.course_id = ''
      }

      if (name === 'programme_id') {
        next.semester_id = ''
        next.course_id = ''
      }

      if (name === 'semester_id') {
        next.course_id = ''
      }

      return next
    })
  }

  function resetForm() {
    setEditingId(null)
    setFormData(emptyCourseOutcome)
    setShowForm(false)
    setMessage('')
    setError('')
  }

  function openAddForm() {
    setEditingId(null)
    setFormData(emptyCourseOutcome)
    setShowForm(true)
    setMessage('')
    setError('')
  }

  function editCourseOutcome(courseOutcome) {
    setEditingId(courseOutcome.co_id)
    setFormData({
      department_id: courseOutcome.department_id ? String(courseOutcome.department_id) : '',
      programme_id: courseOutcome.programme_id ? String(courseOutcome.programme_id) : '',
      semester_id: courseOutcome.semester_id ? String(courseOutcome.semester_id) : '',
      course_id: courseOutcome.course_id ? String(courseOutcome.course_id) : '',
      co_code: courseOutcome.co_code || '',
      co_statement: courseOutcome.co_statement || '',
      bloom_level: courseOutcome.bloom_level || 'Understand',
      target_level: courseOutcome.target_level
        ? Number(courseOutcome.target_level).toFixed(2)
        : '2.50',
      status: courseOutcome.status || 'Active',
    })
    setShowForm(true)
    setMessage('')
    setError('')
  }

  async function saveCourseOutcome(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    const url = editingId
      ? `/api/course-outcomes/${editingId}`
      : '/api/course-outcomes'
    const method = editingId ? 'PUT' : 'POST'

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          department_id: Number(formData.department_id),
          programme_id: Number(formData.programme_id),
          semester_id: Number(formData.semester_id),
          course_id: Number(formData.course_id),
          target_level: Number(formData.target_level),
        }),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save course outcome.')
      }

      setMessage(editingId ? 'Course outcome updated.' : 'Course outcome saved.')
      setEditingId(null)
      setFormData(emptyCourseOutcome)
      setShowForm(false)
      await loadCourseOutcomes()
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function uploadCourseOutcomes(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setError('')
    setMessage('')

    if (
      !formData.department_id ||
      !formData.programme_id ||
      !formData.semester_id ||
      !formData.course_id
    ) {
      setError('Select Department, Programme, Semester, and Course before uploading Excel.')
      return
    }

    setIsUploading(true)

    try {
      let savedCount = 0
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      if (!rows.length) {
        throw new Error('Excel sheet has no course outcome rows.')
      }

      for (const [index, row] of rows.entries()) {
        const coCode =
          String(
            getSheetValue(row, ['cocode', 'co', 'code']) || `CO${index + 1}`,
          )
            .trim()
            .toUpperCase()
        const coStatement = String(
          getSheetValue(row, ['costatement', 'statement', 'outcome']),
        ).trim()

        if (!coStatement) {
          throw new Error(`CO Statement is required in Excel row ${index + 2}.`)
        }

        const response = await fetch('/api/course-outcomes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            department_id: Number(formData.department_id),
            programme_id: Number(formData.programme_id),
            semester_id: Number(formData.semester_id),
            course_id: Number(formData.course_id),
            co_code: coCode,
            co_statement: coStatement,
            bloom_level:
              String(
                getSheetValue(row, ['boomlevel', 'bloomlevel', 'bloom', 'level']),
              ).trim() || 'Understand',
            target_level:
              Number(getSheetValue(row, ['targetlevel', 'target'])) || 2.5,
            status: String(getSheetValue(row, ['status'])).trim() || 'Active',
          }),
        })
        const data = await readResponseJson(response)

        if (!response.ok) {
          throw new Error(
            data?.detail ||
              data?.error ||
              `Unable to save Excel row ${index + 2}.`,
          )
        }

        savedCount += 1
      }

      setMessage(`${savedCount} course outcomes uploaded and saved.`)
      await loadCourseOutcomes()
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setIsUploading(false)
    }
  }

  function downloadCourseOutcomeFormat() {
    const worksheet = XLSX.utils.json_to_sheet([
      {
        'CO Code': 'CO1',
        'CO Statement': 'Understand basic concepts of data structures',
        Status: 'Active',
      },
      {
        'CO Code': 'CO2',
        'CO Statement': 'Apply data structure operations',
        Status: 'Active',
      },
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Course Outcomes')
    XLSX.writeFile(workbook, 'course-outcomes-format.xlsx')
  }

  async function deleteCourseOutcome(coId) {
    setError('')
    setMessage('')

    try {
      const response = await fetch(`/api/course-outcomes/${coId}`, {
        method: 'DELETE',
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to delete course outcome.')
      }

      if (editingId === coId) {
        resetForm()
      }

      setMessage('Course outcome deleted.')
      await loadCourseOutcomes()
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  return (
    <section className="department-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Course Outcomes Management</p>
          <h3>Course Outcomes</h3>
        </div>
        <button type="button" className="action-button" onClick={openAddForm}>
          + Import COs
        </button>
      </div>

      {showForm && (
        <form className="department-form">
          <div className="form-heading">
            <h4>Import Course Outcomes</h4>
            <span>Excel upload</span>
          </div>

          <label>
            <span>Department</span>
            <select
              name="department_id"
              value={formData.department_id}
              onChange={updateField}
              required
            >
              <option value="">Select Department</option>
              {departments.map((department) => (
                <option key={department.department_id} value={department.department_id}>
                  {department.department_name} ({department.department_code})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Programme</span>
            <select
              name="programme_id"
              value={formData.programme_id}
              onChange={updateField}
              required
            >
              <option value="">Select Programme</option>
              {filteredProgrammes.map((programme) => (
                <option key={programme.programme_id} value={programme.programme_id}>
                  {programme.programme_name} ({programme.programme_code})
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Semester</span>
            <select
              name="semester_id"
              value={formData.semester_id}
              onChange={updateField}
              required
            >
              <option value="">Select Semester</option>
              {filteredSemesters.map((semester) => (
                <option key={semester.semester_id} value={semester.semester_id}>
                  {semester.semester_name || `Sem ${semester.semester_number}`}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Course</span>
            <select
              name="course_id"
              value={formData.course_id}
              onChange={updateField}
              required
            >
              <option value="">Select Course</option>
              {filteredCourses.map((course) => (
                <option key={course.course_id} value={course.course_id}>
                  {course.course_code} - {course.course_name}
                </option>
              ))}
            </select>
          </label>

          <label className="wide-field">
            <span>Import Excel</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={uploadCourseOutcomes}
              disabled={isUploading}
            />
          </label>

          <div className="form-actions">
            <button type="button" className="save-button" onClick={downloadCourseOutcomeFormat}>
              Download Excel Format
            </button>
            <span className="form-status">
              {isUploading ? 'Uploading Excel...' : 'Columns: CO Code, CO Statement, Status'}
            </span>
            <button type="button" className="reset-button" onClick={resetForm}>
              Close
            </button>
          </div>
        </form>
      )}

      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Course Outcomes List</h4>
          <span>{isLoading ? 'Loading...' : `${courseOutcomes.length} records`}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sl.No</th>
                <th>Dept</th>
                <th>Programme</th>
                <th>Sem</th>
                <th>Course Code</th>
                <th>CO Code</th>
                <th>Bloom Level</th>
                <th>Bloom Code</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {courseOutcomes.map((courseOutcome, index) => (
                <tr key={courseOutcome.co_id}>
                  <td>{index + 1}</td>
                  <td>{courseOutcome.department_code || '-'}</td>
                  <td>{courseOutcome.programme_code || '-'}</td>
                  <td>{courseOutcome.semester_number || '-'}</td>
                  <td>{courseOutcome.course_code || '-'}</td>
                  <td>{courseOutcome.co_code}</td>
                  <td>{displayBloomCode(courseOutcome.bloom_code)}</td>
                  <td>{courseOutcome.bloom_level}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        onClick={() => deleteCourseOutcome(courseOutcome.co_id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!courseOutcomes.length && !isLoading && (
                <tr>
                  <td colSpan="9" className="empty-cell">
                    No course outcomes found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function ProgrammeOutcomesPage({ user }) {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [outcomes, setOutcomes] = useState([])
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('')
  const [selectedProgrammeId, setSelectedProgrammeId] = useState('')
  const [poForm, setPoForm] = useState(emptyProgrammeOutcome)
  const [psoForm, setPsoForm] = useState(emptyProgrammeOutcome)
  const [editingPoId, setEditingPoId] = useState(null)
  const [editingPsoId, setEditingPsoId] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const isDepartmentLocked = user?.role !== 'Admin'

  const filteredProgrammes = useMemo(
    () =>
      programmes.filter(
        (programme) => String(programme.department_id) === selectedDepartmentId,
      ),
    [programmes, selectedDepartmentId],
  )

  const filteredOutcomes = useMemo(
    () =>
      outcomes.filter(
        (outcome) =>
          (!selectedDepartmentId || String(outcome.department_id) === selectedDepartmentId) &&
          (!selectedProgrammeId || String(outcome.programme_id) === selectedProgrammeId),
      ),
    [outcomes, selectedDepartmentId, selectedProgrammeId],
  )

  const poList = filteredOutcomes.filter(
    (outcome) => outcome.outcome_type === 'PO',
  )
  const psoList = filteredOutcomes.filter(
    (outcome) => outcome.outcome_type === 'PSO',
  )
  const peoList = filteredOutcomes.filter(
    (outcome) => outcome.outcome_type === 'PEO',
  )

  async function loadDepartments() {
    if (isDepartmentLocked) {
      const response = await fetch(`/api/branch-wise-report-options?user_id=${user?.user_id || ''}`)
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load the permitted department.')
      const departmentRows = data?.department ? [data.department] : []
      setDepartments(departmentRows)
      setSelectedDepartmentId(data?.department ? String(data.department.department_id) : '')
      if (!data?.department) throw new Error('No department permission is assigned to this user.')
      return
    }
    const response = await fetch('/api/departments')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load departments.')
    }

    setDepartments(data || [])
  }

  async function loadProgrammes() {
    const response = await fetch('/api/programmes')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load programmes.')
    }

    setProgrammes(data || [])
  }

  async function loadOutcomes() {
    const response = await fetch('/api/programme-outcomes')
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to load PO/PSO/PEO records.')
    }

    setOutcomes(data || [])
  }

  async function refreshProgrammeOutcomesPage() {
    setIsLoading(true)
    setError('')

    try {
      await Promise.all([loadDepartments(), loadProgrammes(), loadOutcomes()])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshProgrammeOutcomesPage()
  }, [isDepartmentLocked, user?.user_id])

  useEffect(() => {
    if (!isDepartmentLocked || !selectedDepartmentId) return
    setSelectedProgrammeId(
      filteredProgrammes.length ? String(filteredProgrammes[0].programme_id) : '',
    )
  }, [filteredProgrammes, isDepartmentLocked, selectedDepartmentId])

  function updateSelectedDepartment(event) {
    setSelectedDepartmentId(event.target.value)
    setSelectedProgrammeId('')
    resetPoForm()
    resetPsoForm()
  }

  function updatePoField(event) {
    const { name, value } = event.target
    setPoForm((current) => ({ ...current, [name]: value }))
  }

  function updatePsoField(event) {
    const { name, value } = event.target
    setPsoForm((current) => ({ ...current, [name]: value }))
  }

  function resetPoForm() {
    setEditingPoId(null)
    setPoForm(emptyProgrammeOutcome)
  }

  function resetPsoForm() {
    setEditingPsoId(null)
    setPsoForm(emptyProgrammeOutcome)
  }

  function buildPayload(type, form) {
    const outcomeCode = normalizeOutcomeCode(type, form.code)

    return {
      department_id: Number(selectedDepartmentId),
      programme_id: Number(selectedProgrammeId),
      outcome_type: type,
      outcome_code: outcomeCode,
      po_code: outcomeCode,
      pso_code: outcomeCode,
      outcome_title: form.title,
      outcome_statement: form.statement,
      status: form.status,
    }
  }

  async function saveProgrammeOutcome(event, type) {
    event.preventDefault()
    setError('')
    setMessage('')

    const isPo = type === 'PO'
    const editingId = isPo ? editingPoId : editingPsoId
    const form = isPo ? poForm : psoForm
    const url = editingId
      ? `/api/programme-outcomes/${editingId}`
      : '/api/programme-outcomes'
    const method = editingId ? 'PUT' : 'POST'

    try {
      const payload = buildPayload(type, form)
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save PO/PSO/PEO.')
      }

      setMessage(`${type} ${editingId ? 'updated' : 'saved'}.`)
      if (isPo) {
        resetPoForm()
      } else {
        resetPsoForm()
      }
      await loadOutcomes()
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function uploadOutcomeExcel(event, type) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    if (!selectedDepartmentId || !selectedProgrammeId) {
      setError('Select Department and Programme before importing Excel.')
      return
    }

    setIsUploading(true)
    setError('')
    setMessage('')

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      if (!rows.length) {
        throw new Error(`Excel sheet has no ${type} rows.`)
      }

      for (const [index, row] of rows.entries()) {
        const rawCode = getSheetValue(row, [
          'code',
          'outcomecode',
          `${type.toLowerCase()}code`,
          type.toLowerCase(),
        ])
        const outcomeCode = normalizeOutcomeCode(type, rawCode || index + 1)
        const outcomeTitle = String(
          getSheetValue(row, [
            'title',
            'outcometitle',
            `${type.toLowerCase()}title`,
          ]),
        ).trim()
        const outcomeStatement = String(
          getSheetValue(row, [
            'statement',
            'outcomestatement',
            `${type.toLowerCase()}statement`,
            'description',
          ]),
        ).trim()
        const status = String(getSheetValue(row, ['status']) || 'Active').trim()

        if (!outcomeCode || !outcomeTitle || !outcomeStatement) {
          throw new Error(`Row ${index + 2}: Code, Title, and Statement are required.`)
        }

        const response = await fetch('/api/programme-outcomes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            department_id: Number(selectedDepartmentId),
            programme_id: Number(selectedProgrammeId),
            outcome_type: type,
            outcome_code: outcomeCode,
            po_code: outcomeCode,
            pso_code: outcomeCode,
            outcome_title: outcomeTitle,
            outcome_statement: outcomeStatement,
            status: status || 'Active',
          }),
        })
        const data = await readResponseJson(response)

        if (!response.ok) {
          throw new Error(data?.detail || data?.error || `Row ${index + 2}: unable to save.`)
        }

      }

      await loadOutcomes()
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setIsUploading(false)
    }
  }

  function downloadOutcomeFormat(type) {
    const worksheet = XLSX.utils.json_to_sheet([
      type === 'PO'
        ? {
            Code: 'PO1',
            Title: 'Engineering knowledge',
            Statement:
              'Apply the knowledge of mathematics, science, engineering fundamentals, and computer science and business systems to the solution of complex engineering and societal problems.',
            Status: 'Active',
          }
        : type === 'PSO'
          ? {
            Code: 'PSO1',
            Title: 'Software development',
            Statement: 'Develop software applications using modern engineering tools and practices.',
            Status: 'Active',
          }
          : {
              Code: 'PEO1',
              Title: 'Professional excellence',
              Statement: 'Graduates will establish successful careers in engineering and related professional fields.',
              Status: 'Active',
            },
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, type)
    XLSX.writeFile(workbook, `${type.toLowerCase()}-format.xlsx`)
  }

  function editProgrammeOutcome(outcome) {
    const formData = {
      code: outcome.outcome_code || '',
      title: outcome.outcome_title || '',
      statement: outcome.outcome_statement || '',
      status: outcome.status || 'Active',
    }

    setSelectedDepartmentId(outcome.department_id ? String(outcome.department_id) : '')
    setSelectedProgrammeId(outcome.programme_id ? String(outcome.programme_id) : '')
    setMessage('')
    setError('')

    if (outcome.outcome_type === 'PO') {
      setEditingPoId(outcome.outcome_id)
      setPoForm(formData)
    } else {
      setEditingPsoId(outcome.outcome_id)
      setPsoForm(formData)
    }
  }

  async function deleteProgrammeOutcome(outcome) {
    setError('')
    setMessage('')

    try {
      const response = await fetch(`/api/programme-outcomes/${outcome.outcome_id}`, {
        method: 'DELETE',
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to delete PO/PSO/PEO.')
      }

      if (editingPoId === outcome.outcome_id) {
        resetPoForm()
      }

      if (editingPsoId === outcome.outcome_id) {
        resetPsoForm()
      }

      setMessage(`${outcome.outcome_type} deleted.`)
      await loadOutcomes()
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  function renderOutcomeForm(type, form, editingId, onChange, onReset) {
    const label = type
    const heading = type === 'PO'
      ? 'Programme Outcomes - PO'
      : type === 'PSO'
        ? 'Programme Specific Outcomes - PSO'
        : 'Programme Educational Objectives - PEO'

    return (
      <div className="department-form">
        <div className="form-heading">
          <h4>{heading}</h4>
          <span>Excel import</span>
        </div>

        <label className="wide-field">
          <span>Import {label} Excel</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(event) => uploadOutcomeExcel(event, type)}
            disabled={isDepartmentLocked || isUploading}
          />
        </label>

        <div className="form-actions">
          <button
            type="button"
            className="save-button"
            onClick={() => downloadOutcomeFormat(type)}
            disabled={isDepartmentLocked}
          >
            Excel Format
          </button>
          <span className="form-status">
            {isUploading ? 'Uploading Excel...' : 'Columns: Code, Title, Statement, Status'}
          </span>
        </div>
      </div>
    )
  }

  function renderOutcomeList(type, list) {
    return (
      <div className="table-panel">
        <div className="table-heading">
          <h4>{type} List</h4>
          <span>{isLoading ? 'Loading...' : `${list.length} records`}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sl.No</th>
                <th>Programme</th>
                <th>{type} Code</th>
                <th>{type} Title</th>
                <th>{type} Statement</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((outcome, index) => (
                <tr key={outcome.outcome_id}>
                  <td>{index + 1}</td>
                  <td>{outcome.programme_code || '-'}</td>
                  <td>{outcome.outcome_code}</td>
                  <td>{outcome.outcome_title}</td>
                  <td>{outcome.outcome_statement || '-'}</td>
                  <td>{outcome.status}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => deleteProgrammeOutcome(outcome)} disabled={isDepartmentLocked}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && !isLoading && (
                <tr>
                  <td colSpan="7" className="empty-cell">
                    No {type} records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <section className="department-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">PO/PSO/PEO Management</p>
          <h3>PO/PSO/PEO</h3>
        </div>
      </div>

      <form className="department-form">
        <label>
          <span>Department</span>
          <select
            value={selectedDepartmentId}
            onChange={updateSelectedDepartment}
            disabled={isDepartmentLocked}
            required
          >
            <option value="">Select Department</option>
            {departments.map((department) => (
              <option key={department.department_id} value={department.department_id}>
                {department.department_name} ({department.department_code})
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Programme</span>
          <select
            value={selectedProgrammeId}
            onChange={(event) => setSelectedProgrammeId(event.target.value)}
            disabled={isDepartmentLocked}
            required
          >
            <option value="">Select Programme</option>
            {filteredProgrammes.map((programme) => (
              <option key={programme.programme_id} value={programme.programme_id}>
                {programme.programme_name} ({programme.programme_code})
              </option>
            ))}
          </select>
        </label>
      </form>

      {isDepartmentLocked && selectedDepartmentId && <div className="notice success">Department and Programme are fixed for this user. PO, PSO, and PEO lists are restricted to this selection.</div>}

      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      {renderOutcomeForm('PO', poForm, editingPoId, updatePoField, resetPoForm)}
      {renderOutcomeList('PO', poList)}
      {renderOutcomeForm('PSO', psoForm, editingPsoId, updatePsoField, resetPsoForm)}
      {renderOutcomeList('PSO', psoList)}
      {renderOutcomeForm('PEO', emptyProgrammeOutcome, null, null, null)}
      {renderOutcomeList('PEO', peoList)}
    </section>
  )
}

function DepartmentVisionMissionPage({ user }) {
  const [departments, setDepartments] = useState([])
  const [departmentId, setDepartmentId] = useState('')
  const [content, setContent] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const isDepartmentLocked = user?.role !== 'Admin'

  useEffect(() => {
    if (isDepartmentLocked) {
      fetch(`/api/branch-wise-report-options?user_id=${user?.user_id || ''}`).then(async (response) => {
        const data = await readResponseJson(response)
        if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load the permitted department.')
        const departmentRows = data?.department ? [data.department] : []
        setDepartments(departmentRows)
        setDepartmentId(data?.department ? String(data.department.department_id) : '')
        if (!data?.department) setError('No department permission is assigned to this user.')
      }).catch((loadError) => setError(loadError.message))
      return
    }
    fetch('/api/departments').then(async (response) => {
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load departments.')
      setDepartments(data || [])
    }).catch((loadError) => setError(loadError.message))
  }, [isDepartmentLocked, user?.user_id])

  useEffect(() => {
    if (!departmentId) { setContent([]); return }
    fetch(`/api/department-vision-mission?department_id=${departmentId}`).then(async (response) => {
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load department Vision and Mission.')
      setContent(data || [])
    }).catch((loadError) => setError(loadError.message))
  }, [departmentId])

  function downloadFormat(type) {
    const label = type === 'VISION' ? 'Vision' : 'Mission'
    const rows = type === 'MISSION'
      ? [
          { Type: type, Code: 'M1.', Title: label, Statement: 'To impart high-quality technical education and promote research activities among students, enabling them to excel as innovative and globally competent professionals.', Status: 'Active' },
          { Type: type, Code: 'M2.', Title: label, Statement: 'To bridge the gap between industry and academia by fostering student development initiatives aligned with industry needs.', Status: 'Active' },
          { Type: type, Code: 'M3.', Title: label, Statement: 'To develop expertise in solving complex technical problems through an application-based learning approach.', Status: 'Active' },
          { Type: type, Code: 'M4.', Title: label, Statement: 'To nurture ethical and socially responsible engineers by providing an environment that emphasizes professional integrity, creativity, and teamwork.', Status: 'Active' },
        ]
      : [{ Type: type, Code: 'V1', Title: label, Statement: 'Enter department vision statement here', Status: 'Active' }]
    const worksheet = XLSX.utils.json_to_sheet(rows)
    worksheet['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 100 }, { wch: 12 }]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, label)
    XLSX.writeFile(workbook, `department-${label.toLowerCase()}-format.xlsx`)
  }

  async function uploadExcel(event, type) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!departmentId) { setError('Select Department before uploading Excel.'); setMessage(''); return }
    setError('')
    setMessage('')
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' })
      const firstRow = rows[0] || {}
      const uploadedTypes = rows.map((row) => String(getSheetValue(row, ['type', 'contenttype'])).trim().toUpperCase()).filter(Boolean)
      const title = String(getSheetValue(firstRow, ['title', 'label']) || type).trim()
      const statements = rows.map((row, index) => {
        const value = String(getSheetValue(row, ['statement', 'contentstatement', 'description'])).trim()
        if (!value) return ''
        const code = String(getSheetValue(row, ['code', 'missioncode', 'visioncode'])).trim() || (type === 'MISSION' ? `M${index + 1}` : '')
        return code ? `${code.replace(/\.*$/, '')}. ${value}` : value
      }).filter(Boolean)
      const statement = statements.join('\n')
      const status = String(getSheetValue(firstRow, ['status']) || 'Active').trim()
      if (uploadedTypes.some((uploadedType) => uploadedType !== type)) throw new Error(`Upload the ${type} Excel format in the correct section.`)
      if (!statement) throw new Error('Statement is required in the uploaded Excel file.')
      const response = await fetch(`/api/department-vision-mission/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ department_id: Number(departmentId), content_title: title, content_statement: statement, status }) })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || `Unable to save ${type}.`)
      setContent((current) => [...current.filter((item) => item.content_type !== type), data])
      setMessage(`${type === 'VISION' ? 'Vision' : 'Mission'} uploaded and saved to the department_vision_mission table.`)
    } catch (uploadError) { setError(uploadError.message) }
  }

  const selectedDepartment = departments.find((row) => String(row.department_id) === departmentId)

  return <section className="department-page">
    <div className="section-title"><div><p className="eyebrow">Department Management</p><h3>Department Vision and Mission</h3></div></div>
    <form className="department-form"><label><span>Department</span><select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setError(''); setMessage('') }} disabled={isDepartmentLocked}><option value="">Select Department</option>{departments.map((row) => <option key={row.department_id} value={row.department_id}>{row.department_name} ({row.department_code})</option>)}</select></label></form>
    {error && <div className="notice error">{error}</div>}
    {message && <div className="notice success">{message}</div>}
    <div className="department-vision-mission-grid">
      {['VISION', 'MISSION'].map((type) => { const row = content.find((item) => item.content_type === type); const label = type === 'VISION' ? 'Vision' : 'Mission'; const heading = selectedDepartment ? `${label} of ${selectedDepartment.department_name} Department` : `Department ${label}`; return <article className="vision-mission-content-card" key={type}><h4>{heading}</h4><p>{row?.content_statement || `Select a department and upload the ${label} Excel file to display the statement.`}</p><div className="vision-mission-actions"><button type="button" className="save-button" onClick={() => downloadFormat(type)} disabled={isDepartmentLocked}>{label} Excel Format</button><label className={`file-action${isDepartmentLocked ? ' disabled' : ''}`} aria-disabled={isDepartmentLocked}>Upload {label}<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => uploadExcel(event, type)} disabled={isDepartmentLocked} /></label></div></article> })}
      <div className="department-vision-mission-logo">
        <img src={departmentVisionMissionImage} alt="Department Vision and Mission" />
      </div>
    </div>
  </section>
}

function ReportPage() {
  return <section className="department-page">
    <div className="section-title">
      <div>
        <p className="eyebrow">Reports</p>
        <h3>Report</h3>
        <p>View and export OBE reports from this module.</p>
      </div>
    </div>
    <div className="table-panel">
      <div className="table-heading"><h4>Available Reports</h4><span>Report module</span></div>
      <div className="empty-cell">Report options will be displayed here.</div>
    </div>
  </section>
}

function SubjectWiseReportPage({ reportName = 'Course Wise', user }) {
  const [departments, setDepartments] = useState([])
  const [courses, setCourses] = useState([])
  const [courseOutcomes, setCourseOutcomes] = useState([])
  const [departmentId, setDepartmentId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const isBranchLocked = ['Department Wise', 'Course Wise'].includes(reportName) && user?.role !== 'Admin'
  const isCourseLocked = reportName === 'Course Wise' && user?.role !== 'Admin'

  const filteredCourses = useMemo(
    () => courses.filter((course) => String(course.department_id) === departmentId && course.status !== 'Inactive'),
    [courses, departmentId],
  )
  const selectedDepartment = departments.find((department) => String(department.department_id) === departmentId)
  const selectedCourse = courses.find((course) => String(course.course_id) === courseId)

  useEffect(() => {
    if (isBranchLocked) {
      fetch(`/api/branch-wise-report-options?user_id=${user?.user_id || ''}`)
        .then(async (response) => {
          const data = await readResponseJson(response)
          if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load assigned branch and subjects.')
          const departmentRows = data?.department ? [data.department] : []
          setDepartments(departmentRows)
          setCourses(data?.courses || [])
          setDepartmentId(data?.department ? String(data.department.department_id) : '')
          setCourseId(isCourseLocked && data?.courses?.length ? String(data.courses[0].course_id) : '')
          if (!data?.department) setError('No branch permission is assigned to this faculty login.')
        })
        .catch((loadError) => setError(loadError.message))
      return
    }
    Promise.all(['/api/departments', '/api/courses'].map(async (url) => {
      const response = await fetch(url)
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load report masters.')
      return data
    })).then(([departmentRows, courseRows]) => {
      setDepartments(departmentRows || [])
      setCourses(courseRows || [])
    }).catch((loadError) => setError(loadError.message))
  }, [isBranchLocked, isCourseLocked, user?.user_id])

  useEffect(() => {
    if (!courseId) { setCourseOutcomes([]); return }
    setIsLoading(true)
    setError('')
    fetch(`/api/course-outcomes?course_id=${courseId}`)
      .then(async (response) => {
        const data = await readResponseJson(response)
        if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load subject report data.')
        setCourseOutcomes(data || [])
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setIsLoading(false))
  }, [courseId])

  function setExcelCell(sheet, address, value) {
    const existingStyle = sheet[address]?.s
    sheet[address] = { t: typeof value === 'number' ? 'n' : 's', v: value ?? '' }
    if (existingStyle) sheet[address].s = existingStyle
  }

  async function exportSubjectWiseReport() {
    if (!selectedDepartment || !selectedCourse) { setError('Select Department and Course Name before exporting.'); return }
    setIsExporting(true)
    setError('')
    try {
      const templateResponse = await fetch(subjectWiseReportTemplateUrl)
      if (!templateResponse.ok) throw new Error('Unable to load the report Excel template.')
      const workbook = XLSX.read(await templateResponse.arrayBuffer(), { type: 'array', cellStyles: true })

      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName]
        setExcelCell(sheet, 'A1', 'Department')
        setExcelCell(sheet, 'B1', `${selectedDepartment.department_code} - ${selectedDepartment.department_name}`)
        setExcelCell(sheet, 'A2', 'Course Code')
        setExcelCell(sheet, 'B2', selectedCourse.course_code)
        setExcelCell(sheet, 'A3', 'Course Name')
        setExcelCell(sheet, 'B3', selectedCourse.course_name)
        sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: XLSX.utils.decode_range(sheet['!ref'] || 'A1:B3').e })
      })

      const coSheet = workbook.Sheets.COS || XLSX.utils.aoa_to_sheet([])
      workbook.Sheets.COS = coSheet
      setExcelCell(coSheet, 'A5', 'CO Code')
      setExcelCell(coSheet, 'B5', 'CO Statement')
      courseOutcomes.forEach((row, index) => {
        setExcelCell(coSheet, `A${index + 6}`, row.co_code || '')
        setExcelCell(coSheet, `B${index + 6}`, row.co_statement || '')
      })
      coSheet['!cols'] = [{ wch: 14 }, { wch: 90 }]
      coSheet['!ref'] = `A1:B${Math.max(5, courseOutcomes.length + 5)}`

      const reportSlug = reportName.toLowerCase().replace(/\s+/g, '-')
      XLSX.writeFile(workbook, `${reportSlug}-${selectedCourse.course_code || selectedCourse.course_id}.xlsx`, { cellStyles: true })
    } catch (exportError) {
      setError(exportError.message)
    } finally {
      setIsExporting(false)
    }
  }

  return <section className="department-page">
    <div className="section-title"><div><p className="eyebrow">Reports</p><h3>{reportName} Report</h3></div></div>
    <div className="department-form student-master-form">
      <label><span>Department</span><select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setCourseId(''); setCourseOutcomes([]) }} disabled={isBranchLocked}><option value="">Select Department</option>{departments.map((row) => <option key={row.department_id} value={row.department_id}>{row.department_code} - {row.department_name}</option>)}</select></label>
      <label><span>Course Name</span><select value={courseId} onChange={(event) => setCourseId(event.target.value)} disabled={!departmentId || isCourseLocked}><option value="">Select Course Name</option>{filteredCourses.map((row) => <option key={row.course_id} value={row.course_id}>{row.course_code} - {row.course_name}</option>)}</select></label>
      <div className="form-actions"><button type="button" className="save-button" onClick={exportSubjectWiseReport} disabled={!courseId || isExporting}>{isExporting ? 'Generating Excel...' : reportName === 'Course Wise' ? 'Export to Course Report' : reportName === 'Department Wise' ? 'Export to Department Report' : reportName === 'All Departments' ? 'Export to All Departments Report' : `Export ${reportName} Excel`}</button></div>
    </div>
    {isBranchLocked && departmentId && <div className="notice success">{isCourseLocked ? 'Branch and Course Name are fixed from the permissions and subject assignment given to this faculty.' : 'Branch is fixed from Faculty Permission Management. Course Name contains only subjects assigned to this faculty.'}</div>}
    {error && <div className="notice error">{error}</div>}
    <div className="table-panel"><div className="table-heading"><h4>{selectedCourse ? `${selectedCourse.course_code} - ${selectedCourse.course_name}` : 'Course Outcomes'}</h4><span>{isLoading ? 'Loading...' : `${courseOutcomes.length} records`}</span></div><div className="table-wrap"><table><thead><tr><th>CO Code</th><th>CO Statement</th><th>Bloom Level</th><th>Target Level</th></tr></thead><tbody>{courseOutcomes.map((row) => <tr key={row.co_id}><td>{row.co_code}</td><td>{row.co_statement}</td><td>{row.bloom_level || row.bloom_code || '-'}</td><td>{row.target_level || '-'}</td></tr>)}{!courseOutcomes.length && !isLoading && <tr><td colSpan="4" className="empty-cell">Select Department and Course Name to load subject data.</td></tr>}</tbody></table></div></div>
  </section>
}

function DashboardPage({ user }) {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [courses, setCourses] = useState([])
  const [dashboardContent, setDashboardContent] = useState([])
  const [error, setError] = useState('')
  const [uploadingDashboardType, setUploadingDashboardType] = useState('')
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ new_password: '', confirm_password: '' })
  const [passwordMessage, setPasswordMessage] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const isDashboardActionsDisabled = user?.role !== 'Admin'

  async function loadDashboard() {
    setIsLoading(true)
    setError('')

    try {
      const [departmentsResponse, programmesResponse, coursesResponse, dashboardContentResponse] =
        await Promise.all([
          fetch('/api/departments'),
          fetch('/api/programmes'),
          fetch('/api/courses'),
          fetch('/api/dashboard-content'),
        ])

      const [departmentsData, programmesData, coursesData, dashboardContentData] = await Promise.all([
        readResponseJson(departmentsResponse),
        readResponseJson(programmesResponse),
        readResponseJson(coursesResponse),
        readResponseJson(dashboardContentResponse),
      ])

      if (!departmentsResponse.ok) {
        throw new Error(
          departmentsData?.detail ||
            departmentsData?.error ||
            'Unable to load departments.',
        )
      }

      if (!programmesResponse.ok) {
        throw new Error(
          programmesData?.detail ||
            programmesData?.error ||
            'Unable to load programmes.',
        )
      }

      if (!coursesResponse.ok) {
        throw new Error(
          coursesData?.detail || coursesData?.error || 'Unable to load courses.',
        )
      }

      if (!dashboardContentResponse.ok) {
        throw new Error(dashboardContentData?.detail || dashboardContentData?.error || 'Unable to load Vision and Mission.')
      }

      setDepartments(departmentsData || [])
      setProgrammes(programmesData || [])
      setCourses(coursesData || [])
      setDashboardContent(dashboardContentData || [])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard()
  }, [])

  const dashboardCards = [
    {
      label: 'Departments',
      value: departments.length,
    },
    {
      label: 'Programmes',
      value: programmes.length,
    },
    {
      label: 'Courses',
      value: courses.length,
    },
  ]

  function downloadVisionMissionFormat(type) {
    const label = type === 'VISION' ? 'Vision' : 'Mission'
    const worksheet = XLSX.utils.json_to_sheet([
      {
        Type: type,
        Title: label,
        Statement: `Enter ${label.toLowerCase()} statement here`,
        Status: 'Active',
      },
    ])
    worksheet['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 60 }, { wch: 12 }]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, label)
    XLSX.writeFile(workbook, `${label.toLowerCase()}-format.xlsx`)
  }

  async function uploadVisionMissionExcel(event, type) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploadingDashboardType(type)
    setError('')

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const [row] = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const uploadedType = String(getSheetValue(row || {}, ['type', 'contenttype'])).trim().toUpperCase()
      const title = String(getSheetValue(row || {}, ['title', 'label', 'contentlabel']) || type).trim()
      const statement = String(getSheetValue(row || {}, ['statement', 'contentstatement', 'description'])).trim()
      const status = String(getSheetValue(row || {}, ['status']) || 'Active').trim()

      if (uploadedType && uploadedType !== type) {
        throw new Error(`Upload the ${type === 'VISION' ? 'Vision' : 'Mission'} Excel format in this section.`)
      }
      if (!statement) {
        throw new Error('Statement is required in the uploaded Excel file.')
      }

      const response = await fetch(`/api/dashboard-content/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_label: title, content_statement: statement, status }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || `Unable to save ${type}.`)
      }

      setDashboardContent((current) => [
        ...current.filter((item) => item.content_type !== type),
        data,
      ])
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setUploadingDashboardType('')
    }
  }

  const visionContent = dashboardContent.find((item) => item.content_type === 'VISION')
  const missionContent = dashboardContent.find((item) => item.content_type === 'MISSION')

  async function changePassword(event) {
    event.preventDefault()
    setPasswordMessage('')
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordMessage('New Password and Confirm Password do not match.')
      return
    }
    setIsChangingPassword(true)
    try {
      const response = await fetch(`/api/users/${user.user_id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: passwordForm.new_password }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to change password.')
      setPasswordMessage(data.message)
      setPasswordForm({ new_password: '', confirm_password: '' })
      setShowPasswordForm(false)
    } catch (passwordError) {
      setPasswordMessage(passwordError.message)
    } finally {
      setIsChangingPassword(false)
    }
  }

  return (
    <section className="department-page">
      <div className="dashboard-heading">
        <h3>Ajay Binay Institute of Technology (Autonomous)</h3>
        {user?.role !== 'Admin' && <button type="button" className="action-button change-password-button" onClick={() => setShowPasswordForm((current) => !current)}>Change Password</button>}
      </div>

      {showPasswordForm && <form className="password-change-form" onSubmit={changePassword}>
        <label><span>New Password</span><input type="password" value={passwordForm.new_password} onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))} required minLength="6" /></label>
        <label><span>Confirm Password</span><input type="password" value={passwordForm.confirm_password} onChange={(event) => setPasswordForm((current) => ({ ...current, confirm_password: event.target.value }))} required minLength="6" /></label>
        <button type="submit" className="save-button change-password-button" disabled={isChangingPassword}>{isChangingPassword ? 'Changing...' : 'Save Password'}</button>
      </form>}
      {passwordMessage && <div className="notice success">{passwordMessage}</div>}

      {error && <div className="notice error">{error}</div>}

      <section className="summary-band" aria-label="Dashboard summary">
        {dashboardCards.map((card) => (
          <article className="summary-card dashboard-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{isLoading ? '...' : card.value}</strong>
          </article>
        ))}
      </section>

      <section className="vision-mission-panel" aria-label="Institution vision and mission">
        <article className="vision-mission-content-card">
          <h4>Our Vision</h4>
          <p>{visionContent?.content_statement || 'Upload the Vision Excel file to display the statement.'}</p>
          <div className="vision-mission-actions">
            <button type="button" className="save-button" onClick={() => downloadVisionMissionFormat('VISION')} disabled={isDashboardActionsDisabled}>Vision Excel Format</button>
            <label className={`file-action${isDashboardActionsDisabled ? ' disabled' : ''}`} aria-disabled={isDashboardActionsDisabled}>
              {uploadingDashboardType === 'VISION' ? 'Uploading...' : 'Upload Vision'}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => uploadVisionMissionExcel(event, 'VISION')} disabled={isDashboardActionsDisabled || Boolean(uploadingDashboardType)} />
            </label>
          </div>
        </article>
        <img src={visionMissionImage} alt="Vision and Mission" />
        <article className="vision-mission-content-card">
          <h4>Our Mission</h4>
          <p>{missionContent?.content_statement || 'Upload the Mission Excel file to display the statement.'}</p>
          <div className="vision-mission-actions">
            <button type="button" className="save-button" onClick={() => downloadVisionMissionFormat('MISSION')} disabled={isDashboardActionsDisabled}>Mission Excel Format</button>
            <label className={`file-action${isDashboardActionsDisabled ? ' disabled' : ''}`} aria-disabled={isDashboardActionsDisabled}>
              {uploadingDashboardType === 'MISSION' ? 'Uploading...' : 'Upload Mission'}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => uploadVisionMissionExcel(event, 'MISSION')} disabled={isDashboardActionsDisabled || Boolean(uploadingDashboardType)} />
            </label>
          </div>
        </article>
      </section>
    </section>
  )
}

function AssessmentsPage() {
  const [academicYear, setAcademicYear] = useState('2023-24')
  const [assessmentCategory, setAssessmentCategory] = useState(
    'Internal & External Assessment',
  )
  const [levels, setLevels] = useState(defaultAssessmentLevels)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [savedLevels, setSavedLevels] = useState([])
  const [yearWiseLevels, setYearWiseLevels] = useState([])
  const [showForm, setShowForm] = useState(false)

  async function loadYearWiseLevels(category = assessmentCategory) {
    try {
      const params = new URLSearchParams({ assessment_category: category, all_years: 'true' })
      const response = await fetch(`/api/assessment-attainment-levels?${params}`)
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load year-wise levels.')
      setYearWiseLevels(data || [])
    } catch (loadError) {
      setError(loadError.message)
    }
  }

  async function loadLevels(year = academicYear, category = assessmentCategory) {
    setIsLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({
        academic_year: year,
        assessment_category: category,
      })
      const response = await fetch(`/api/assessment-attainment-levels?${params}`)
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to load levels.')
      }

      if (data?.length) {
        setSavedLevels(data)
        setLevels(
          data.map((level) => ({
            level_number: level.level_number,
            code: level.code,
            level_name: level.level_name,
            min_percentage: String(level.min_percentage),
            max_percentage: String(level.max_percentage),
            condition_text: level.condition_text,
          })),
        )
      } else {
        setSavedLevels([])
        setLevels(defaultAssessmentLevels)
      }
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadLevels()
  }, [academicYear, assessmentCategory])

  useEffect(() => {
    loadYearWiseLevels()
  }, [assessmentCategory])

  function updateLevel(index, field, value) {
    setLevels((current) =>
      current.map((level, levelIndex) =>
        levelIndex === index ? { ...level, [field]: value } : level,
      ),
    )
  }

  function resetLevels() {
    setLevels(defaultAssessmentLevels)
    setMessage('')
    setError('')
    setShowForm(false)
  }

  function openAddAssessment() {
    setLevels(defaultAssessmentLevels)
    setMessage('')
    setError('')
    setShowForm(true)
  }

  function editSavedLevels() {
    if (!savedLevels.length) {
      return
    }

    setLevels(
      savedLevels.map((level) => ({
        level_number: level.level_number,
        code: level.code,
        level_name: level.level_name,
        min_percentage: String(level.min_percentage),
        max_percentage: String(level.max_percentage),
        condition_text: level.condition_text,
      })),
    )
    setMessage('Saved levels loaded for editing.')
    setError('')
    setShowForm(true)
  }

  function editYearLevels(year, category) {
    const selectedLevels = yearWiseLevels.filter(
      (level) => level.academic_year === year && level.assessment_category === category,
    )
    setAcademicYear(year)
    setAssessmentCategory(category)
    setSavedLevels(selectedLevels)
    setLevels(selectedLevels.map((level) => ({
      level_number: level.level_number,
      code: level.code,
      level_name: level.level_name,
      min_percentage: String(level.min_percentage),
      max_percentage: String(level.max_percentage),
      condition_text: level.condition_text,
    })))
    setMessage('Saved levels loaded for editing.')
    setError('')
    setShowForm(true)
  }

  async function deleteSavedLevel(levelId) {
    setMessage('')
    setError('')

    try {
      const response = await fetch(`/api/assessment-attainment-levels/${levelId}`, {
        method: 'DELETE',
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to delete level.')
      }

      setMessage('Target level deleted.')
      await loadLevels()
      await loadYearWiseLevels()
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  function getPreviousAcademicYear(year) {
    const [start, end] = year.split('-').map((part) => Number(part))

    if (Number.isNaN(start) || Number.isNaN(end)) {
      return targetAcademicYears[0]
    }

    return `${start - 1}-${String(end - 1).padStart(2, '0')}`
  }

  async function copyFromPreviousYear() {
    const previousYear = getPreviousAcademicYear(academicYear)
    setMessage('')
    setError('')

    try {
      const params = new URLSearchParams({
        academic_year: previousYear,
        assessment_category: assessmentCategory,
      })
      const response = await fetch(`/api/assessment-attainment-levels?${params}`)
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to copy previous year.')
      }

      if (!data?.length) {
        setMessage(`No saved levels found for ${previousYear}.`)
        return
      }

      setLevels(
        data.map((level) => ({
          level_number: level.level_number,
          code: level.code,
          level_name: level.level_name,
          min_percentage: String(level.min_percentage),
          max_percentage: String(level.max_percentage),
          condition_text: level.condition_text,
        })),
      )
      setMessage(`Copied levels from ${previousYear}.`)
    } catch (copyError) {
      setError(copyError.message)
    }
  }

  async function saveLevels(event) {
    event.preventDefault()
    setMessage('')
    setError('')

    try {
      const response = await fetch('/api/assessment-attainment-levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academic_year: academicYear,
          assessment_category: assessmentCategory,
          levels: levels.map((level) => ({
            ...level,
            level_number: Number(level.level_number),
            min_percentage: Number(level.min_percentage),
            max_percentage: Number(level.max_percentage),
          })),
        }),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save levels.')
      }

      setMessage('Target levels saved.')
      await loadLevels()
      await loadYearWiseLevels()
      setShowForm(false)
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  return (
    <section className="department-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Set Target</p>
          <h3>Target Level Settings</h3>
        </div>
        <button type="button" className="action-button" onClick={openAddAssessment}>
          + Add New Target
        </button>
      </div>

      {showForm && (
        <form className="department-form assessment-form" onSubmit={saveLevels}>
          <label>
            <span>Academic Year</span>
            <select
              value={academicYear}
              onChange={(event) => setAcademicYear(event.target.value)}
            >
              {targetAcademicYears.map((year) => (
                <option key={year}>{year}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Target Category</span>
            <select
              value={assessmentCategory}
              onChange={(event) => setAssessmentCategory(event.target.value)}
            >
              {assessmentCategories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>

          <div className="table-panel levels-panel">
            <div className="table-heading">
              <h4>Level Configuration</h4>
              <span>{isLoading ? 'Loading...' : `${levels.length} levels`}</span>
            </div>
            <div className="table-wrap">
              <table className="levels-table">
                <thead>
                  <tr>
                    <th>Level</th>
                    <th>Code</th>
                    <th>Level Name</th>
                    <th>Min %</th>
                    <th>Max %</th>
                    <th>Condition</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.map((level, index) => (
                    <tr key={level.level_number}>
                      <td>{level.level_number}</td>
                      <td>
                        <input
                          value={level.code}
                          onChange={(event) => updateLevel(index, 'code', event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={level.level_name}
                          onChange={(event) =>
                            updateLevel(index, 'level_name', event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={level.min_percentage}
                          onChange={(event) =>
                            updateLevel(index, 'min_percentage', event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={level.max_percentage}
                          onChange={(event) =>
                            updateLevel(index, 'max_percentage', event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={level.condition_text}
                          onChange={(event) =>
                            updateLevel(index, 'condition_text', event.target.value)
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="save-button">
              Save Levels
            </button>
            <button type="button" className="reset-button" onClick={resetLevels}>
              Reset
            </button>
          </div>
        </form>
      )}

      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <div>
            <h4>Level Configuration - Year Wise</h4>
            <span>Target Category: {assessmentCategory}</span>
          </div>
          <span>{isLoading ? 'Loading...' : `${yearWiseLevels.length} records`}</span>
        </div>
        <div className="table-wrap">
          <table className="year-wise-levels-table">
            <thead>
              <tr>
                <th>Academic Year</th>
                <th>Target Category</th>
                <th>Level Name</th>
                <th>Level Code</th>
                <th>Condition</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {yearWiseLevels.map((level, index) => {
                const startsNewYear = index > 0 && yearWiseLevels[index - 1].academic_year !== level.academic_year
                return (
                <tr className={startsNewYear ? 'year-separator' : ''} key={level.level_id}>
                  <td>{level.academic_year}</td>
                  <td>{level.assessment_category}</td>
                  <td>{level.level_name}</td>
                  <td>{level.code}</td>
                  <td>{level.condition_text}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => editYearLevels(level.academic_year, level.assessment_category)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSavedLevel(level.level_id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
              {!yearWiseLevels.length && !isLoading && (
                <tr>
                  <td colSpan="6" className="empty-cell">
                    No saved target levels found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

const poHeaders = Array.from({ length: 12 }, (_item, index) => `PO${index + 1}`)
const psoHeaders = ['PSO1', 'PSO2', 'PSO3']
const articulationAssessmentColumns = [
  { key: 'attend', label: 'ATTEND' },
  { key: 'a1', label: 'A1' },
  { key: 'a2', label: 'A2' },
  { key: 'qt1', label: 'QT1' },
  { key: 'qt2', label: 'QT2' },
  { key: 'st1', label: 'ST1' },
  { key: 'st2', label: 'ST2' },
  { key: 'ct1', label: 'CT1' },
  { key: 'ct2', label: 'CT2' },
]
const articulationExternalColumns = [{ key: 'end_sem', label: 'END SEM' }]
const articulationMatrixColumns = [
  ...articulationAssessmentColumns,
  ...articulationExternalColumns,
]
const markAttainmentTools = [
  { key: 'attd', label: 'ATTENDANCE', weightage: 5 },
  { key: 'a1', label: 'A1', weightage: 2.5 },
  { key: 'a2', label: 'A2', weightage: 2.5 },
  { key: 'qt1', label: 'QT1', weightage: 2.5 },
  { key: 'qt2', label: 'QT2', weightage: 2.5 },
  { key: 'st1', label: 'ST1', weightage: 2.5 },
  { key: 'st2', label: 'ST2', weightage: 2.5 },
  { key: 'ct1', label: 'CT1', weightage: 15 },
  { key: 'ct2', label: 'CT2', weightage: 15 },
  { key: 'end_sem', label: 'END SEM', weightage: 100 },
]
const coAttainmentColumns = [
  { key: 'attend', markKey: 'attd', label: 'ATTENDANCE' },
  { key: 'a1', markKey: 'a1', label: 'A1' },
  { key: 'a2', markKey: 'a2', label: 'A2' },
  { key: 'qt1', markKey: 'qt1', label: 'QT1' },
  { key: 'qt2', markKey: 'qt2', label: 'QT2' },
  { key: 'st1', markKey: 'st1', label: 'ST1' },
  { key: 'st2', markKey: 'st2', label: 'ST2' },
  { key: 'ct1', markKey: 'ct1', label: 'CT1' },
  { key: 'ct2', markKey: 'ct2', label: 'CT2' },
]
const coAttainmentResultColumns = [
  { key: 'internal_attainment', label: 'ATTAINMENT LEVEL (INTERNAL)' },
  { key: 'end_sem', label: 'END SEM' },
  { key: 'external_attainment', label: 'ATTAINMENT LEVEL (EXTERNAL)' },
  { key: 'overall', label: 'OVERALL' },
]
const attainmentLevelPointMap = { LL: 1, ML: 2, HL: 3 }

function emptyMappingForOutcomes(outcomes, headers) {
  return outcomes.reduce((mapping, outcome) => {
    mapping[outcome.code] = headers.map(() => 0)
    return mapping
  }, {})
}

function normalizeArticulationCell(value) {
  const numberValue = Number(value || 0)

  if (!Number.isFinite(numberValue)) {
    return 0
  }

  return Math.max(0, Math.min(3, Math.round(numberValue)))
}

function normalizeCourseOutcomeCode(value) {
  const code = String(value || '').trim().toUpperCase().replace(/\s+/g, '')
  const match = code.match(/CO-?(\d+)$/)

  return match ? `CO${match[1]}` : code.replace(/[^A-Z0-9]/g, '')
}

function displayBloomCode(value) {
  return String(value || '').trim().toUpperCase().replace(/^B([1-6])$/, 'L$1') || '-'
}

function getAssessmentLevel(attainmentPercent) {
  const matchedLevel = defaultAssessmentLevels.find((level) => {
    const minPercentage = Number(level.min_percentage)
    const maxPercentage = Number(level.max_percentage)
    return attainmentPercent >= minPercentage && attainmentPercent <= maxPercentage
  })
  const level = matchedLevel?.code || '-'

  return {
    level,
    levelPoint: attainmentLevelPointMap[level] || '-',
  }
}

function normalizeArticulationMatrixRow(row) {
  const nextRow = {
    co_code: String(row.co_code || row.course_outcome || '').trim().toUpperCase(),
  }

  articulationMatrixColumns.forEach((column) => {
    nextRow[column.key] = normalizeArticulationCell(row[column.key])
  })

  return nextRow
}

function MappingLevelInput({ value, onChange, label }) {
  return (
    <select
      aria-label={label}
      className={`mapping-level level-${value}`}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      <option value="0">0</option>
      <option value="1">1</option>
      <option value="2">2</option>
      <option value="3">3</option>
    </select>
  )
}

function CoPoMappingPage({ user }) {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [courseOutcomes, setCourseOutcomes] = useState([])
  const [programmeOutcomes, setProgrammeOutcomes] = useState([])
  const [selection, setSelection] = useState({
    department_id: '',
    programme_id: '',
    semester_id: '',
    course_id: '',
    academic_year: '',
  })
  const [poMapping, setPoMapping] = useState({})
  const [psoMapping, setPsoMapping] = useState({})
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingCourseOutcomes, setIsLoadingCourseOutcomes] = useState(false)
  const [isLoadingSavedMapping, setIsLoadingSavedMapping] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const isUserLogin = user?.role !== 'Admin'

  const filteredProgrammes = useMemo(
    () =>
      programmes.filter(
        (programme) => String(programme.department_id) === selection.department_id,
      ),
    [programmes, selection.department_id],
  )

  const filteredSemesters = useMemo(
    () =>
      semesters.filter(
        (semester) =>
          String(semester.department_id) === selection.department_id &&
          String(semester.programme_id) === selection.programme_id,
      ),
    [semesters, selection.department_id, selection.programme_id],
  )

  const filteredCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          String(course.department_id) === selection.department_id &&
          String(course.programme_id) === selection.programme_id &&
          String(course.semester_id) === selection.semester_id,
      ),
    [courses, selection.department_id, selection.programme_id, selection.semester_id],
  )

  const selectedDepartment = useMemo(
    () =>
      departments.find(
        (department) => String(department.department_id) === selection.department_id,
      ),
    [departments, selection.department_id],
  )

  const selectedProgramme = useMemo(
    () =>
      programmes.find(
        (programme) => String(programme.programme_id) === selection.programme_id,
      ),
    [programmes, selection.programme_id],
  )

  const selectedSemester = useMemo(
    () =>
      semesters.find(
        (semester) => String(semester.semester_id) === selection.semester_id,
      ),
    [semesters, selection.semester_id],
  )

  const selectedCourse = useMemo(
    () => courses.find((course) => String(course.course_id) === selection.course_id),
    [courses, selection.course_id],
  )

  const selectedCourseOutcomes = useMemo(
    () =>
      courseOutcomes
        .filter(
          (outcome) => selection.course_id && String(outcome.course_id) === selection.course_id,
        )
        .sort((first, second) => first.co_code.localeCompare(second.co_code))
        .map((outcome) => ({
          id: outcome.co_id,
          code: outcome.co_code,
          statement: outcome.co_statement,
          bloomLevel: outcome.bloom_level,
        })),
    [courseOutcomes, selection.course_id],
  )

  const selectedProgrammeOutcomes = useMemo(
    () =>
      programmeOutcomes.filter(
        (outcome) =>
          String(outcome.programme_id) === selection.programme_id &&
          String(outcome.department_id) === selection.department_id,
      ),
    [programmeOutcomes, selection.department_id, selection.programme_id],
  )

  const outcomeIdByTypeAndCode = useMemo(() => {
    const nextMap = new Map()

    selectedProgrammeOutcomes.forEach((outcome) => {
      const type = String(outcome.outcome_type || '').trim().toUpperCase()
      const code = String(outcome.outcome_code || '').trim().toUpperCase()

      if (type && code && outcome.po_id) {
        nextMap.set(`${type}:${code}`, outcome.po_id)
      }
    })

    return nextMap
  }, [selectedProgrammeOutcomes])

  const outcomeCodeById = useMemo(() => {
    const nextMap = new Map()

    selectedProgrammeOutcomes.forEach((outcome) => {
      const type = String(outcome.outcome_type || '').trim().toUpperCase()
      const code = String(outcome.outcome_code || '').trim().toUpperCase()

      if (type && code && outcome.po_id) {
        nextMap.set(String(outcome.po_id), { type, code })
      }
    })

    return nextMap
  }, [selectedProgrammeOutcomes])

  const applySavedMappingRows = useCallback(
    (rows) => {
      const nextPoMapping = emptyMappingForOutcomes(selectedCourseOutcomes, poHeaders)
      const nextPsoMapping = emptyMappingForOutcomes(selectedCourseOutcomes, psoHeaders)
      const coCodeById = new Map(
        selectedCourseOutcomes.map((outcome) => [String(outcome.id), outcome.code]),
      )

      rows.forEach((row) => {
        const coCode = String(row.co_code || coCodeById.get(String(row.co_id)) || '').trim().toUpperCase()
        const savedOutcome = outcomeCodeById.get(String(row.po_id))
        const outcomeType = String(row.outcome_type || savedOutcome?.type || '').trim().toUpperCase()
        const outcomeCode = String(row.outcome_code || savedOutcome?.code || '').trim().toUpperCase()
        const mappingLevel = Number(row.mapping_level)

        if (!coCode || !Number.isInteger(mappingLevel) || mappingLevel < 0 || mappingLevel > 3) {
          return
        }

        if (outcomeType === 'PO') {
          const index = poHeaders.indexOf(outcomeCode)

          if (index >= 0 && nextPoMapping[coCode]) {
            nextPoMapping[coCode][index] = mappingLevel
          }
        }

        if (outcomeType === 'PSO') {
          const index = psoHeaders.indexOf(outcomeCode)

          if (index >= 0 && nextPsoMapping[coCode]) {
            nextPsoMapping[coCode][index] = mappingLevel
          }
        }
      })

      setPoMapping(nextPoMapping)
      setPsoMapping(nextPsoMapping)
    },
    [outcomeCodeById, selectedCourseOutcomes],
  )

  useEffect(() => {
    async function loadMappingMasters() {
      setIsLoading(true)
      setError('')

      try {
        const responses = await Promise.all([
          fetch('/api/departments'),
          fetch('/api/programmes'),
          fetch('/api/semesters'),
          fetch('/api/courses'),
          fetch('/api/programme-outcomes'),
          ...(isUserLogin
            ? [fetch(`/api/branch-wise-report-options?user_id=${user?.user_id || ''}`)]
            : []),
        ])
        const data = await Promise.all(responses.map((response) => readResponseJson(response)))

        responses.forEach((response, index) => {
          if (!response.ok) {
            throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load mapping data.')
          }
        })

        const permittedDepartment = isUserLogin ? data[5]?.department : null
        setDepartments(isUserLogin ? (permittedDepartment ? [permittedDepartment] : []) : (data[0] || []))
        setProgrammes(data[1] || [])
        setSemesters(data[2] || [])
        setCourses(data[3] || [])
        setProgrammeOutcomes(data[4] || [])
        setCourseOutcomes([])
        setSelection({ department_id: '', programme_id: '', semester_id: '', course_id: '', academic_year: '' })
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadMappingMasters()
  }, [isUserLogin, user?.user_id])

  useEffect(() => {
    async function loadSelectedCourseOutcomes() {
      if (!selection.course_id) {
        setCourseOutcomes([])
        return
      }

      setIsLoadingCourseOutcomes(true)
      setError('')

      try {
        const response = await fetch(`/api/course-outcomes?course_id=${selection.course_id}`)
        const data = await readResponseJson(response)

        if (!response.ok) {
          throw new Error(data?.detail || data?.error || 'Unable to load course outcomes.')
        }

        setCourseOutcomes(data || [])
      } catch (loadError) {
        setCourseOutcomes([])
        setError(loadError.message)
      } finally {
        setIsLoadingCourseOutcomes(false)
      }
    }

    loadSelectedCourseOutcomes()
  }, [selection.course_id])

  useEffect(() => {
    const hasSelectedProgramme = filteredProgrammes.some(
      (programme) => String(programme.programme_id) === selection.programme_id,
    )

    if (selection.department_id && !hasSelectedProgramme) {
      setSelection((current) => ({
        ...current,
        programme_id: filteredProgrammes[0] ? String(filteredProgrammes[0].programme_id) : '',
        semester_id: '',
        course_id: '',
      }))
    }
  }, [filteredProgrammes, selection.department_id, selection.programme_id])

  useEffect(() => {
    const hasSelectedSemester = filteredSemesters.some(
      (semester) => String(semester.semester_id) === selection.semester_id,
    )

    if (selection.programme_id && !hasSelectedSemester) {
      setSelection((current) => ({
        ...current,
        semester_id: filteredSemesters[0] ? String(filteredSemesters[0].semester_id) : '',
        course_id: '',
      }))
    }
  }, [filteredSemesters, selection.programme_id, selection.semester_id])

  useEffect(() => {
    const hasSelectedCourse = filteredCourses.some(
      (course) => String(course.course_id) === selection.course_id,
    )

    if (selection.course_id && !hasSelectedCourse) {
      setSelection((current) => ({
        ...current,
        course_id: '',
      }))
    }
  }, [filteredCourses, selection.semester_id, selection.course_id])

  useEffect(() => {
    let isCurrent = true

    async function loadSavedMapping() {
      if (!selection.course_id || !selectedCourseOutcomes.length) {
        setPoMapping(emptyMappingForOutcomes(selectedCourseOutcomes, poHeaders))
        setPsoMapping(emptyMappingForOutcomes(selectedCourseOutcomes, psoHeaders))
        setMessage('')
        setError('')
        return
      }

      setIsLoadingSavedMapping(true)
      setMessage('')
      setError('')

      try {
        const response = await fetch(`/api/co-po-mapping?course_id=${selection.course_id}`)
        const data = await readResponseJson(response)

        if (!response.ok) {
          throw new Error(data?.detail || data?.error || 'Unable to load saved mapping.')
        }

        if (isCurrent) {
          applySavedMappingRows(data || [])
        }
      } catch (loadError) {
        if (isCurrent) {
          setPoMapping(emptyMappingForOutcomes(selectedCourseOutcomes, poHeaders))
          setPsoMapping(emptyMappingForOutcomes(selectedCourseOutcomes, psoHeaders))
          setError(loadError.message)
        }
      } finally {
        if (isCurrent) {
          setIsLoadingSavedMapping(false)
        }
      }
    }

    loadSavedMapping()

    return () => {
      isCurrent = false
    }
  }, [applySavedMappingRows, selection.course_id, selectedCourseOutcomes])

  function updateSelection(event) {
    const { name, value } = event.target

    setSelection((current) => {
      const next = { ...current, [name]: value }

      if (name === 'department_id') {
        next.programme_id = ''
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'programme_id') {
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'semester_id') {
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'course_id') {
        const course = courses.find((row) => String(row.course_id) === value)
        const semester = semesters.find((row) => String(row.semester_id) === String(course?.semester_id || next.semester_id))
        next.academic_year = String(semester?.academic_year || '')
      }

      return next
    })
    setMessage('')
    setError('')
  }

  function updatePoMapping(coCode, index, value) {
    setPoMapping((current) => ({
      ...current,
      [coCode]: (current[coCode] || poHeaders.map(() => 0)).map((item, itemIndex) =>
        itemIndex === index ? value : item,
      ),
    }))
    setMessage('')
    setError('')
  }

  function updatePsoMapping(coCode, index, value) {
    setPsoMapping((current) => ({
      ...current,
      [coCode]: (current[coCode] || psoHeaders.map(() => 0)).map((item, itemIndex) =>
        itemIndex === index ? value : item,
      ),
    }))
    setMessage('')
    setError('')
  }

  async function saveMapping() {
    setIsSaving(true)
    setMessage('')
    setError('')

    if (!selectedDepartment || !selectedProgramme || !selectedSemester || !selectedCourse) {
      setIsSaving(false)
      setError('Select Department, Programme, Semester, and Course before saving.')
      return
    }

    if (!selectedCourseOutcomes.length) {
      setIsSaving(false)
      setError('No course outcomes found for the selected course.')
      return
    }

    const missingOutcomes = []
    const buildRows = (headers, type, mapping) =>
      selectedCourseOutcomes.flatMap((outcome) =>
        headers.flatMap((outcomeCode, index) => {
          const mappingLevel = mapping[outcome.code]?.[index] || 0
          const poId = outcomeIdByTypeAndCode.get(`${type}:${outcomeCode}`)

          if (!poId) {
            if (mappingLevel > 0) {
              missingOutcomes.push(outcomeCode)
            }

            return []
          }

          return [
            {
              co_id: outcome.id,
              po_id: poId,
              mapping_level: mappingLevel,
            },
          ]
        }),
      )

    const mappings = [
      ...buildRows(poHeaders, 'PO', poMapping),
      ...buildRows(psoHeaders, 'PSO', psoMapping),
    ]
    const uniqueMissingOutcomes = [...new Set(missingOutcomes)]

    if (uniqueMissingOutcomes.length) {
      setIsSaving(false)
      setError(`PO/PSO setup missing for ${uniqueMissingOutcomes.join(', ')}.`)
      return
    }

    if (!mappings.length) {
      setIsSaving(false)
      setError('No PO/PSO outcome setup found for the selected programme.')
      return
    }

    try {
      const response = await fetch('/api/co-po-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings }),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save mapping.')
      }

      const savedResponse = await fetch(`/api/co-po-mapping?course_id=${selection.course_id}`)
      const savedData = await readResponseJson(savedResponse)

      if (!savedResponse.ok) {
        throw new Error(savedData?.detail || savedData?.error || 'Unable to reload saved mapping.')
      }

      applySavedMappingRows(savedData || [])
      setMessage(data?.message || 'CO-PO mapping saved.')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="department-page co-po-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Dashboard / OBE Setup / CO-PO Mapping</p>
          <h3>CO-PO / CO-PSO Mapping</h3>
        </div>
      </div>

      <div className="mapping-selector-grid">
        <label>
          <span>Department</span>
          <select
            name="department_id"
            value={selection.department_id}
            onChange={updateSelection}
            disabled={isLoading || !departments.length}
          >
            <option value="">Select Department</option>
            {departments.map((department) => (
              <option key={department.department_id} value={department.department_id}>
                {department.department_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Programme</span>
          <select
            name="programme_id"
            value={selection.programme_id}
            onChange={updateSelection}
            disabled={!selection.department_id || !filteredProgrammes.length}
          >
            <option value="">Select Programme</option>
            {filteredProgrammes.map((programme) => (
              <option key={programme.programme_id} value={programme.programme_id}>
                {programme.programme_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Semester</span>
          <select
            name="semester_id"
            value={selection.semester_id}
            onChange={updateSelection}
            disabled={!selection.programme_id || !filteredSemesters.length}
          >
            <option value="">Select Semester</option>
            {filteredSemesters.map((semester) => (
              <option key={semester.semester_id} value={semester.semester_id}>
                {semester.semester_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Course</span>
          <select
            name="course_id"
            value={selection.course_id}
            onChange={updateSelection}
            disabled={!selection.semester_id || !filteredCourses.length}
          >
            <option value="">Select Course</option>
            {filteredCourses.map((course) => (
              <option key={course.course_id} value={course.course_id}>
                {course.course_code} - {course.course_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading && <div className="notice success">Loading mapping data...</div>}
      {isLoadingCourseOutcomes && <div className="notice success">Loading course outcomes...</div>}
      {isLoadingSavedMapping && <div className="notice success">Loading saved mapping...</div>}
      {error && <div className="notice error">{error}</div>}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Course Outcomes</h4>
          <span>{selectedCourseOutcomes.length} outcomes</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>CO Code</th>
                <th>CO Statement</th>
                <th>Bloom Level</th>
              </tr>
            </thead>
            <tbody>
              {selectedCourseOutcomes.map((outcome) => (
                <tr key={outcome.code}>
                  <td>{outcome.code}</td>
                  <td>{outcome.statement}</td>
                  <td>{outcome.bloomLevel}</td>
                </tr>
              ))}
              {!selectedCourseOutcomes.length && !isLoading && !isLoadingCourseOutcomes && (
                <tr>
                  <td colSpan="3" className="empty-cell">
                    {selection.course_id
                      ? 'No course outcomes found for the selected course.'
                      : 'Select a course to display course outcomes.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mapping-legend">
        <strong>Mapping Level:</strong>
        <span>0 = No Mapping</span>
        <span>1 = Low</span>
        <span>2 = Medium</span>
        <span>3 = High</span>
      </div>

      <div className="table-panel">
        <div className="table-heading">
          <h4>CO-PO Mapping Matrix</h4>
          <span>PO1 - PO12</span>
        </div>
        <div className="mapping-scroll">
          <div className="mapping-grid po-grid mapping-grid-head">
            <span>CO</span>
            {poHeaders.map((po) => (
              <span key={po}>{po}</span>
            ))}
          </div>
          {selectedCourseOutcomes.map((outcome) => (
            <div className="mapping-grid po-grid" key={outcome.code}>
              <strong>{outcome.code}</strong>
              {(poMapping[outcome.code] || poHeaders.map(() => 0)).map((value, index) => (
                <MappingLevelInput
                  key={`${outcome.code}-${poHeaders[index]}`}
                  label={`${outcome.code} ${poHeaders[index]}`}
                  value={value}
                  onChange={(nextValue) => updatePoMapping(outcome.code, index, nextValue)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="table-panel">
        <div className="table-heading">
          <h4>CO-PSO Mapping Matrix</h4>
          <span>PSO1 - PSO3</span>
        </div>
        <div className="mapping-scroll">
          <div className="mapping-grid pso-grid mapping-grid-head">
            <span>CO</span>
            {psoHeaders.map((pso) => (
              <span key={pso}>{pso}</span>
            ))}
          </div>
          {selectedCourseOutcomes.map((outcome) => (
            <div className="mapping-grid pso-grid" key={outcome.code}>
              <strong>{outcome.code}</strong>
              {(psoMapping[outcome.code] || psoHeaders.map(() => 0)).map((value, index) => (
                <MappingLevelInput
                  key={`${outcome.code}-${psoHeaders[index]}`}
                  label={`${outcome.code} ${psoHeaders[index]}`}
                  value={value}
                  onChange={(nextValue) => updatePsoMapping(outcome.code, index, nextValue)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="mapping-actions">
        <button type="button" className="save-button" onClick={saveMapping} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Mapping'}
        </button>
      </div>
    </section>
  )
}

function CoPoAttainmentPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [selection, setSelection] = useState({
    department_id: '', programme_id: '', semester_id: '', course_id: '',
    academic_year: '', batch: '2022-26',
  })
  const [mappingRows, setMappingRows] = useState([])
  const [coAttainmentRows, setCoAttainmentRows] = useState([])
  const [showAverages, setShowAverages] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [, setIsLoading] = useState(false)

  const filteredProgrammes = useMemo(() => programmes.filter((item) =>
    String(item.department_id) === selection.department_id), [programmes, selection.department_id])
  const filteredSemesters = useMemo(() => semesters.filter((item) =>
    String(item.department_id) === selection.department_id &&
    String(item.programme_id) === selection.programme_id),
  [semesters, selection.department_id, selection.programme_id])
  const filteredCourses = useMemo(() => courses.filter((item) =>
    String(item.department_id) === selection.department_id &&
    String(item.programme_id) === selection.programme_id &&
    String(item.semester_id) === selection.semester_id),
  [courses, selection.department_id, selection.programme_id, selection.semester_id])

  const selectedCourseCoCodes = useMemo(() => [...new Set(
    mappingRows.map((row) => normalizeCourseOutcomeCode(row.co_code)).filter(Boolean),
  )].sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''))), [mappingRows])

  const matrix = useMemo(() => {
    const next = Object.fromEntries(coCodeOptions.map((code) => [code, Object.fromEntries(poHeaders.map((po) => [po, 0]))]))
    mappingRows.forEach((row) => {
      const co = normalizeCourseOutcomeCode(row.co_code)
      const rawPo = String(row.outcome_code || row.po_code || '').trim().toUpperCase()
      const poMatch = rawPo.replace(/[^A-Z0-9]/g, '').match(/^PO0*(\d+)$/)
      const po = poMatch ? `PO${Number(poMatch[1])}` : rawPo
      if (next[co] && poHeaders.includes(po)) {
        next[co][po] = Number(row.mapping_level || 0)
      }
    })
    return next
  }, [mappingRows])
  const averages = useMemo(() => Object.fromEntries(poHeaders.map((po) => {
    const values = coCodeOptions.map((co) => matrix[co][po]).filter((value) => value > 0)
    return [po, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0]
  })), [matrix])
  const attainmentByCo = useMemo(() => coAttainmentRows.reduce((next, row) => {
    const coCode = normalizeCourseOutcomeCode(row.co_code || row.CO || row.course_outcome)
    const overallValue = row.results?.overall ?? row.results?.OVERALL ?? row.overall ?? row.OVERALL
    if (coCodeOptions.includes(coCode)) {
      next[coCode] = Number(overallValue || 0)
    }
    return next
  }, {}), [coAttainmentRows])
  const directPoAttainment = useMemo(() => Object.fromEntries(poHeaders.map((po) => {
    const mappedAttainmentValues = coCodeOptions
      .filter((co) => Number(matrix[co][po] || 0) > 0)
      .map((co) => Number(attainmentByCo[co] || 0))
      .filter((value) => value > 0)
    return [po, mappedAttainmentValues.length
      ? mappedAttainmentValues.reduce((sum, value) => sum + value, 0) / mappedAttainmentValues.length
      : 0]
  })), [attainmentByCo, matrix])

  useEffect(() => {
    Promise.all(['/api/departments', '/api/programmes', '/api/semesters', '/api/courses'].map(async (url) => {
      const response = await fetch(url)
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load master data.')
      return data
    })).then(([departmentData, programmeData, semesterData, courseData]) => {
      setDepartments(departmentData || [])
      setProgrammes(programmeData || [])
      setSemesters(semesterData || [])
      setCourses(courseData || [])
    }).catch((loadError) => setError(loadError.message))
  }, [])

  function updateSelection(event) {
    const { name, value } = event.target
    setSelection((current) => {
      const next = { ...current, [name]: value }
      if (name === 'department_id') Object.assign(next, { programme_id: '', semester_id: '', course_id: '', academic_year: '' })
      if (name === 'programme_id') Object.assign(next, { semester_id: '', course_id: '', academic_year: '' })
      if (name === 'semester_id') Object.assign(next, { course_id: '', academic_year: '' })
      if (name === 'course_id') {
        const course = courses.find((row) => String(row.course_id) === value)
        const semester = semesters.find((row) => String(row.semester_id) === String(course?.semester_id || next.semester_id))
        next.academic_year = String(semester?.academic_year || '')
      }
      return next
    })
    if (['department_id', 'programme_id', 'semester_id', 'course_id'].includes(name)) {
      setMappingRows([])
      setCoAttainmentRows([])
      setShowAverages(true)
    }
    setMessage('')
    setError('')
  }

  async function loadMapping() {
    if (!selection.course_id) { setError('Select Department, Programme, Semester, and Course.'); return }
    setIsLoading(true); setError(''); setMessage('')
    try {
      const attainmentQuery = `course_id=${selection.course_id}&academic_year=${encodeURIComponent(selection.academic_year)}&batch=${encodeURIComponent(selection.batch)}`
      const responses = await Promise.all([
        fetch(`/api/co-po-mapping?course_id=${selection.course_id}`),
        fetch(`/api/co-attainment-calculation?${attainmentQuery}`),
        fetch(`/api/mark-attainment?course_id=${selection.course_id}&academic_year=${encodeURIComponent(selection.academic_year)}`),
        fetch(`/api/articulation-matrix?course_id=${selection.course_id}`),
        fetch(`/api/university-question-rubric?course_id=${selection.course_id}`),
        fetch(`/api/external-marks-upload?course_id=${selection.course_id}&academic_year=${encodeURIComponent(selection.academic_year)}`),
      ])
      const data = await Promise.all(responses.map((response) => readResponseJson(response)))
      responses.forEach((response, index) => {
        if (!response.ok) throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load attainment data.')
      })
      setMappingRows(data[0] || [])
      const savedRowData = typeof data[1]?.row_data === 'string'
        ? JSON.parse(data[1].row_data)
        : data[1]?.row_data
      const savedCoRows = savedRowData?.coRows || savedRowData?.co_rows || savedRowData?.rows || []
      const markRowsByTool = (data[2] || []).reduce((next, row) => {
        next[row.assessment_tool] = row
        return next
      }, {})
      const articulationRowsByCo = (data[3] || []).reduce((next, row) => {
        next[normalizeCourseOutcomeCode(row.co_code)] = normalizeArticulationMatrixRow(row)
        return next
      }, {})
      const rubricByCo = (data[4] || []).reduce((next, row) => {
        next[normalizeCourseOutcomeCode(row.co_code)] = Number(row.rubric || 0)
        return next
      }, {})
      const externalPercent = Number(data[5]?.[0]?.attainment_value)
      const externalLevelPoint = Number.isFinite(externalPercent)
        ? Number(getAssessmentLevel(externalPercent).levelPoint || 0)
        : Number(markRowsByTool.end_sem?.level_point || 0)
      const liveCoRows = coCodeOptions.map((coCode) => {
        let articulationTotal = 0
        let weightedLevelPointTotal = 0
        coAttainmentColumns.forEach((column) => {
          const articulationLevel = Number(articulationRowsByCo[coCode]?.[column.key] || 0)
          const levelPoint = Number(markRowsByTool[column.markKey]?.level_point || 0)
          if (articulationLevel) {
            articulationTotal += articulationLevel
            weightedLevelPointTotal += articulationLevel * levelPoint
          }
        })
        const internalAttainment = articulationTotal ? weightedLevelPointTotal / articulationTotal : 0
        const externalAttainmentValue = rubricByCo[coCode] && externalLevelPoint ? externalLevelPoint : 0
        const overall = internalAttainment || externalAttainmentValue
          ? (0.33 * internalAttainment) + (0.67 * externalAttainmentValue)
          : 0
        return { co_code: coCode, results: { overall: overall ? Number(overall.toFixed(2)) : '' } }
      })
      const hasLiveOverallValues = liveCoRows.some((row) => Number(row.results.overall) > 0)
      const displayedCoRows = hasLiveOverallValues ? liveCoRows : savedCoRows
      setCoAttainmentRows(displayedCoRows)
      setShowAverages(false)
      setMessage(displayedCoRows.length
        ? 'CO-PO mapping and live CO Attainment OVERALL values loaded.'
        : 'CO-PO mapping loaded, but no CO Attainment source data was found for this selection.')
    } catch (loadError) { setError(loadError.message) } finally { setIsLoading(false) }
  }

  useEffect(() => {
    if (selection.course_id) {
      loadMapping()
    }
  }, [selection.academic_year, selection.batch, selection.course_id])

  async function saveAttainment() {
    setError(''); setMessage('')
    if (!selection.department_id || !selection.programme_id || !selection.semester_id || !selection.course_id || !selection.academic_year) {
      setError('Select Department, Programme, Semester, and Course before saving.')
      return
    }
    if (!selectedCourseCoCodes.length) {
      setError('No CO-PO Mapping rows found for the selected course.')
      return
    }
    setIsSaving(true)
    try {
      const response = await fetch('/api/co-po-attainment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selection,
          department_id: Number(selection.department_id),
          programme_id: Number(selection.programme_id),
          semester_id: Number(selection.semester_id),
          course_id: Number(selection.course_id),
          row_data: {
            articulation_matrix: selectedCourseCoCodes.map((co) => ({ co_code: co, ...matrix[co] })),
            articulation_average: averages,
            direct_method_rows: selectedCourseCoCodes.map((co) => ({
              co_code: co,
              attainment_level: Number(attainmentByCo[co] || 0),
              ...matrix[co],
            })),
            direct_method_output: directPoAttainment,
          },
        }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to save CO-PO Attainment.')
      setMessage(data?.message || 'CO-PO Attainment saved.')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="page-section">
      <div className="section-title">
        <div><span>Attainment</span><h3>CO-PO Attainment</h3></div>
        <button type="button" className="save-button" onClick={saveAttainment} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
      <div className="mapping-selector-grid">
        <label><span>Department</span><select name="department_id" value={selection.department_id} onChange={updateSelection}><option value="">Select Department</option>{departments.map((item) => <option key={item.department_id} value={item.department_id}>{item.department_name}</option>)}</select></label>
        <label><span>Programme</span><select name="programme_id" value={selection.programme_id} onChange={updateSelection}><option value="">Select Programme</option>{filteredProgrammes.map((item) => <option key={item.programme_id} value={item.programme_id}>{item.programme_name}</option>)}</select></label>
        <label><span>Semester</span><select name="semester_id" value={selection.semester_id} onChange={updateSelection}><option value="">Select Semester</option>{filteredSemesters.map((item) => <option key={item.semester_id} value={item.semester_id}>{item.semester_name}</option>)}</select></label>
        <label><span>Course</span><select name="course_id" value={selection.course_id} onChange={updateSelection}><option value="">Select Course</option>{filteredCourses.map((item) => <option key={item.course_id} value={item.course_id}>{item.course_code} - {item.course_name}</option>)}</select></label>
      </div>
      {selection.course_id && (
        <div className={`notice ${selection.academic_year ? 'success' : 'error'}`}>
          {selection.academic_year
            ? `Academic Year: ${selection.academic_year} (automatically selected from Course)`
            : 'Academic Year is not configured for the selected Course Semester.'}
        </div>
      )}
      {(message || error) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || message}</div>}
      <div className="table-panel">
        <div className="table-heading">
          <h4>Program Articulation Matrix</h4>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>CO</th>
                {poHeaders.map((po) => <th key={po}>{po}</th>)}
              </tr>
            </thead>
            <tbody>
              {selectedCourseCoCodes.map((co) => (
                <tr key={co}>
                  <th>{co}</th>
                  {poHeaders.map((po) => (
                    <td key={`${co}-${po}`}>{matrix[co]?.[po] || ''}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <th>AVG</th>
                {poHeaders.map((po) => (
                  <td key={`avg-${po}`}>{averages[po] ? averages[po].toFixed(2) : ''}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="table-panel">
        <div className="table-heading">
          <h4>Program Outcome Attainment Calculation (Direct Method)</h4>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>CO</th>
                <th>ATTAINMENT LEVEL</th>
                {poHeaders.map((po) => <th key={`direct-heading-${po}`}>{po}</th>)}
              </tr>
            </thead>
            <tbody>
              {selectedCourseCoCodes.map((co) => (
                <tr key={`direct-${co}`}>
                  <th>{co}</th>
                  <td>{attainmentByCo[co] ? attainmentByCo[co].toFixed(2) : ''}</td>
                  {poHeaders.map((po) => (
                    <td key={`direct-${co}-${po}`}>{matrix[co]?.[po] || ''}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <th></th>
                <td></td>
                {poHeaders.map((po) => (
                  <td key={`direct-output-${po}`}>
                    {directPoAttainment[po] ? directPoAttainment[po].toFixed(2) : ''}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function CoPsoAttainmentPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [courseOutcomes, setCourseOutcomes] = useState([])
  const [psoMappingRows, setPsoMappingRows] = useState([])
  const [coAttainmentRows, setCoAttainmentRows] = useState([])
  const [selection, setSelection] = useState({
    department_id: '', programme_id: '', semester_id: '', course_id: '', academic_year: '',
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const attainmentByCo = useMemo(() => coAttainmentRows.reduce((next, row) => {
    const coCode = normalizeCourseOutcomeCode(row.co_code || row.CO || row.course_outcome)
    const overall = row.results?.overall ?? row.results?.OVERALL ?? row.overall ?? row.OVERALL
    if (coCode) next[coCode] = Number(overall || 0)
    return next
  }, {}), [coAttainmentRows])
  const psoMatrix = useMemo(() => {
    const next = {}
    courseOutcomes.forEach((outcome) => {
      next[normalizeCourseOutcomeCode(outcome.co_code)] = Object.fromEntries(psoHeaders.map((pso) => [pso, 0]))
    })
    psoMappingRows.forEach((row) => {
      const coCode = normalizeCourseOutcomeCode(row.co_code)
      const psoCode = String(row.outcome_code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (next[coCode] && psoHeaders.includes(psoCode)) next[coCode][psoCode] = Number(row.mapping_level || 0)
    })
    return next
  }, [courseOutcomes, psoMappingRows])
  const directPsoAttainment = useMemo(() => Object.fromEntries(psoHeaders.map((pso) => {
    let weightedTotal = 0
    let mappingTotal = 0
    courseOutcomes.forEach((outcome) => {
      const coCode = normalizeCourseOutcomeCode(outcome.co_code)
      const mappingLevel = Number(psoMatrix[coCode]?.[pso] || 0)
      if (mappingLevel > 0) {
        weightedTotal += Number(attainmentByCo[coCode] || 0) * mappingLevel
        mappingTotal += mappingLevel
      }
    })
    return [pso, mappingTotal ? weightedTotal / mappingTotal : 0]
  })), [attainmentByCo, courseOutcomes, psoMatrix])

  const filteredProgrammes = useMemo(() => programmes.filter((item) =>
    String(item.department_id) === selection.department_id), [programmes, selection.department_id])
  const filteredSemesters = useMemo(() => semesters.filter((item) =>
    String(item.department_id) === selection.department_id &&
    String(item.programme_id) === selection.programme_id),
  [semesters, selection.department_id, selection.programme_id])
  const filteredCourses = useMemo(() => courses.filter((item) =>
    String(item.department_id) === selection.department_id &&
    String(item.programme_id) === selection.programme_id &&
    String(item.semester_id) === selection.semester_id),
  [courses, selection.department_id, selection.programme_id, selection.semester_id])

  useEffect(() => {
    Promise.all(['/api/departments', '/api/programmes', '/api/semesters', '/api/courses'].map(async (url) => {
      const response = await fetch(url)
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load master data.')
      return data
    })).then(([departmentData, programmeData, semesterData, courseData]) => {
      setDepartments(departmentData || [])
      setProgrammes(programmeData || [])
      setSemesters(semesterData || [])
      setCourses(courseData || [])
    }).catch((loadError) => setError(loadError.message))
  }, [])

  useEffect(() => {
    async function loadCourseAttainment() {
      if (!selection.course_id || !selection.academic_year) {
        setCourseOutcomes([])
        setPsoMappingRows([])
        setCoAttainmentRows([])
        return
      }
      setError('')
      try {
        const responses = await Promise.all([
          fetch(`/api/course-outcomes?course_id=${selection.course_id}`),
          fetch(`/api/co-po-mapping?course_id=${selection.course_id}`),
          fetch(`/api/co-attainment-calculation?course_id=${selection.course_id}&academic_year=${encodeURIComponent(selection.academic_year)}`),
          fetch(`/api/mark-attainment?course_id=${selection.course_id}&academic_year=${encodeURIComponent(selection.academic_year)}`),
          fetch(`/api/articulation-matrix?course_id=${selection.course_id}`),
          fetch(`/api/university-question-rubric?course_id=${selection.course_id}`),
          fetch(`/api/external-marks-upload?course_id=${selection.course_id}&academic_year=${encodeURIComponent(selection.academic_year)}`),
        ])
        const data = await Promise.all(responses.map((response) => readResponseJson(response)))
        responses.forEach((response, index) => {
          if (!response.ok) throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load PSO attainment data.')
        })
        const savedRowData = typeof data[2]?.row_data === 'string' ? JSON.parse(data[2].row_data) : data[2]?.row_data
        const savedCoRows = savedRowData?.coRows || savedRowData?.co_rows || savedRowData?.rows || []
        const markRowsByTool = (data[3] || []).reduce((next, row) => {
          next[row.assessment_tool] = row
          return next
        }, {})
        const articulationRowsByCo = (data[4] || []).reduce((next, row) => {
          next[normalizeCourseOutcomeCode(row.co_code)] = normalizeArticulationMatrixRow(row)
          return next
        }, {})
        const rubricByCo = (data[5] || []).reduce((next, row) => {
          next[normalizeCourseOutcomeCode(row.co_code)] = Number(row.rubric || 0)
          return next
        }, {})
        const externalPercent = Number(data[6]?.[0]?.attainment_value)
        const externalLevelPoint = Number.isFinite(externalPercent)
          ? Number(getAssessmentLevel(externalPercent).levelPoint || 0)
          : Number(markRowsByTool.end_sem?.level_point || 0)
        const liveCoRows = (data[0] || []).map((outcome) => {
          const coCode = normalizeCourseOutcomeCode(outcome.co_code)
          let articulationTotal = 0
          let weightedLevelPointTotal = 0
          coAttainmentColumns.forEach((column) => {
            const articulationLevel = Number(articulationRowsByCo[coCode]?.[column.key] || 0)
            const levelPoint = Number(markRowsByTool[column.markKey]?.level_point || 0)
            if (articulationLevel) {
              articulationTotal += articulationLevel
              weightedLevelPointTotal += articulationLevel * levelPoint
            }
          })
          const internalAttainment = articulationTotal ? weightedLevelPointTotal / articulationTotal : 0
          const externalAttainment = rubricByCo[coCode] && externalLevelPoint ? externalLevelPoint : 0
          const overall = internalAttainment || externalAttainment
            ? (0.33 * internalAttainment) + (0.67 * externalAttainment)
            : 0
          return { co_code: coCode, results: { overall: overall ? Number(overall.toFixed(2)) : '' } }
        })
        setCourseOutcomes(data[0] || [])
        setPsoMappingRows((data[1] || []).filter((row) => String(row.outcome_type || '').toUpperCase() === 'PSO'))
        setCoAttainmentRows(savedCoRows.length ? savedCoRows : liveCoRows)
      } catch (loadError) {
        setError(loadError.message)
      }
    }
    loadCourseAttainment()
  }, [selection.academic_year, selection.course_id])

  function updateSelection(event) {
    const { name, value } = event.target
    setSelection((current) => {
      const next = { ...current, [name]: value }
      if (name === 'department_id') Object.assign(next, { programme_id: '', semester_id: '', course_id: '', academic_year: '' })
      if (name === 'programme_id') Object.assign(next, { semester_id: '', course_id: '', academic_year: '' })
      if (name === 'semester_id') Object.assign(next, { course_id: '', academic_year: '' })
      if (name === 'course_id') {
        const course = courses.find((row) => String(row.course_id) === value)
        const semester = semesters.find((row) => String(row.semester_id) === String(course?.semester_id || next.semester_id))
        next.academic_year = String(semester?.academic_year || '')
      }
      return next
    })
    setError('')
    setMessage('')
  }

  async function savePsoAttainment() {
    setError(''); setMessage('')
    if (!selection.department_id || !selection.programme_id || !selection.semester_id || !selection.course_id || !selection.academic_year) {
      setError('Select Department, Programme, Semester, and Course before saving.')
      return
    }
    if (!courseOutcomes.length) {
      setError('No Course Outcomes found for the selected course.')
      return
    }
    setIsSaving(true)
    try {
      const response = await fetch('/api/co-pso-attainment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selection,
          department_id: Number(selection.department_id),
          programme_id: Number(selection.programme_id),
          semester_id: Number(selection.semester_id),
          course_id: Number(selection.course_id),
          row_data: {
            co_rows: courseOutcomes.map((outcome) => {
              const coCode = normalizeCourseOutcomeCode(outcome.co_code)
              return { co_code: coCode, attainment_level: Number(attainmentByCo[coCode] || 0), ...psoMatrix[coCode] }
            }),
            direct_pso_attainment: directPsoAttainment,
          },
        }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to save CO-PSO Attainment.')
      setMessage(data?.message || 'CO-PSO Attainment saved.')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="page-section co-pso-attainment-page">
      <div className="section-title">
        <div><span>Attainment</span><h3>PSO Attainment (Direct Method)</h3></div>
        <button type="button" className="save-button" onClick={savePsoAttainment} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
      <div className="mapping-selector-grid">
        <label><span>Department</span><select name="department_id" value={selection.department_id} onChange={updateSelection}><option value="">Select Department</option>{departments.map((item) => <option key={item.department_id} value={item.department_id}>{item.department_name}</option>)}</select></label>
        <label><span>Programme</span><select name="programme_id" value={selection.programme_id} onChange={updateSelection}><option value="">Select Programme</option>{filteredProgrammes.map((item) => <option key={item.programme_id} value={item.programme_id}>{item.programme_name}</option>)}</select></label>
        <label><span>Semester</span><select name="semester_id" value={selection.semester_id} onChange={updateSelection}><option value="">Select Semester</option>{filteredSemesters.map((item) => <option key={item.semester_id} value={item.semester_id}>{item.semester_name}</option>)}</select></label>
        <label><span>Course</span><select name="course_id" value={selection.course_id} onChange={updateSelection}><option value="">Select Course</option>{filteredCourses.map((item) => <option key={item.course_id} value={item.course_id}>{item.course_code} - {item.course_name}</option>)}</select></label>
      </div>
      {selection.course_id && <div className={`notice ${selection.academic_year ? 'success' : 'error'}`}>
        {selection.academic_year
          ? `Academic Year: ${selection.academic_year} (automatically selected from Course)`
          : 'Academic Year is not configured for the selected Course Semester.'}
      </div>}
      {(message || error) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || message}</div>}
      <div className="table-panel">
        <div className="table-heading">
          <h4>PSO Attainment (Direct Method)</h4>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>CO</th>
                <th>ATTAINMENT LEVEL</th>
                {psoHeaders.map((pso) => <th key={pso}>{pso}</th>)}
              </tr>
            </thead>
            <tbody>
              {courseOutcomes.map((outcome) => {
                const coCode = normalizeCourseOutcomeCode(outcome.co_code)
                return (
                  <tr key={outcome.co_id || coCode}>
                    <th>{outcome.co_code || coCode}</th>
                    <td>{attainmentByCo[coCode] ? attainmentByCo[coCode].toFixed(2) : ''}</td>
                    {psoHeaders.map((pso) => <td key={`${coCode}-${pso}`}>{psoMatrix[coCode]?.[pso] || ''}</td>)}
                  </tr>
                )
              })}
              <tr>
                <th colSpan="2">DIRECT PSO ATTAINMENT</th>
                {psoHeaders.map((pso) => (
                  <td key={`direct-${pso}`}>{directPsoAttainment[pso] ? directPsoAttainment[pso].toFixed(2) : ''}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function ArticulationMatrixPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [courseOutcomes, setCourseOutcomes] = useState([])
  const [rubricRows, setRubricRows] = useState([])
  const [matrixRows, setMatrixRows] = useState([])
  const [selection, setSelection] = useState({
    department_id: '',
    programme_id: '',
    semester_id: '',
    course_id: '',
    academic_year: '',
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const filteredProgrammes = useMemo(
    () => programmes.filter((programme) => String(programme.department_id) === selection.department_id),
    [programmes, selection.department_id],
  )
  const filteredSemesters = useMemo(
    () =>
      semesters.filter(
        (semester) =>
          String(semester.department_id) === selection.department_id &&
          String(semester.programme_id) === selection.programme_id,
      ),
    [semesters, selection.department_id, selection.programme_id],
  )
  const filteredCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          String(course.department_id) === selection.department_id &&
          String(course.programme_id) === selection.programme_id &&
          String(course.semester_id) === selection.semester_id,
      ),
    [courses, selection.department_id, selection.programme_id, selection.semester_id],
  )
  const selectedDepartment = useMemo(
    () => departments.find((department) => String(department.department_id) === selection.department_id),
    [departments, selection.department_id],
  )
  const selectedProgramme = useMemo(
    () => programmes.find((programme) => String(programme.programme_id) === selection.programme_id),
    [programmes, selection.programme_id],
  )
  const selectedSemester = useMemo(
    () => semesters.find((semester) => String(semester.semester_id) === selection.semester_id),
    [semesters, selection.semester_id],
  )
  const selectedCourse = useMemo(
    () => courses.find((course) => String(course.course_id) === selection.course_id),
    [courses, selection.course_id],
  )

  useEffect(() => {
    async function loadMasters() {
      setIsLoading(true)
      setError('')

      try {
        const responses = await Promise.all([
          fetch('/api/departments'),
          fetch('/api/programmes'),
          fetch('/api/semesters'),
          fetch('/api/courses'),
        ])
        const data = await Promise.all(responses.map((response) => readResponseJson(response)))

        responses.forEach((response, index) => {
          if (!response.ok) {
            throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load articulation data.')
          }
        })

        setDepartments(data[0] || [])
        setProgrammes(data[1] || [])
        setSemesters(data[2] || [])
        setCourses(data[3] || [])
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadMasters()
  }, [])

  useEffect(() => {
    async function loadCourseMatrix() {
      if (!selection.course_id) {
        setCourseOutcomes([])
        setMatrixRows([])
        return
      }

      setIsLoading(true)
      setError('')

      try {
        const responses = await Promise.all([
          fetch(`/api/course-outcomes?course_id=${selection.course_id}`),
          fetch(`/api/articulation-matrix?course_id=${selection.course_id}`),
          fetch(`/api/university-question-rubric?course_id=${selection.course_id}`),
        ])
        const data = await Promise.all(responses.map((response) => readResponseJson(response)))

        responses.forEach((response, index) => {
          if (!response.ok) {
            throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load articulation matrix.')
          }
        })

        setCourseOutcomes(data[0] || [])
        setMatrixRows((data[1] || []).map(normalizeArticulationMatrixRow))
        setRubricRows(data[2] || [])
      } catch (loadError) {
        setCourseOutcomes([])
        setRubricRows([])
        setMatrixRows([])
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadCourseMatrix()
  }, [selection.course_id])

  useEffect(() => {
    const rubricMap = new Map(
      rubricRows.map((row) => [normalizeCourseOutcomeCode(row.co_code), normalizeArticulationCell(row.rubric)]),
    )

    setMatrixRows((current) =>
      current.map((row) => ({
        ...row,
        end_sem: rubricMap.get(normalizeCourseOutcomeCode(row.co_code)) ?? 0,
      })),
    )
  }, [rubricRows])

  useEffect(() => {
    const hasSelectedProgramme = filteredProgrammes.some(
      (programme) => String(programme.programme_id) === selection.programme_id,
    )

    if (selection.department_id && !hasSelectedProgramme) {
      setSelection((current) => ({
        ...current,
        programme_id: filteredProgrammes[0] ? String(filteredProgrammes[0].programme_id) : '',
        semester_id: '',
        course_id: '',
      }))
    }
  }, [filteredProgrammes, selection.department_id, selection.programme_id])

  useEffect(() => {
    const hasSelectedSemester = filteredSemesters.some(
      (semester) => String(semester.semester_id) === selection.semester_id,
    )

    if (selection.programme_id && !hasSelectedSemester) {
      setSelection((current) => ({
        ...current,
        semester_id: filteredSemesters[0] ? String(filteredSemesters[0].semester_id) : '',
        course_id: '',
      }))
    }
  }, [filteredSemesters, selection.programme_id, selection.semester_id])

  useEffect(() => {
    const hasSelectedCourse = filteredCourses.some((course) => String(course.course_id) === selection.course_id)

    if (selection.course_id && !hasSelectedCourse) {
      setSelection((current) => ({ ...current, course_id: '' }))
    }
  }, [filteredCourses, selection.course_id])

  function updateSelection(event) {
    const { name, value } = event.target

    setSelection((current) => {
      const next = { ...current, [name]: value }

      if (name === 'department_id') {
        next.programme_id = ''
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'programme_id') {
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'semester_id') {
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'course_id') {
        const course = courses.find((row) => String(row.course_id) === value)
        const semester = semesters.find((row) => String(row.semester_id) === String(course?.semester_id || next.semester_id))
        next.academic_year = String(semester?.academic_year || '')
      }

      return next
    })
    setMessage('')
    setError('')
  }

  function updateMatrixCell(rowIndex, key, value) {
    setMatrixRows((current) =>
      current.map((row, index) =>
        index === rowIndex ? { ...row, [key]: normalizeArticulationCell(value) } : row,
      ),
    )
    setMessage('')
    setError('')
  }

  function parseArticulationExcel(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setError('')
    setMessage('')

    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      try {
        const workbook = XLSX.read(loadEvent.target.result, { type: 'array' })
        const worksheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
        const rubricMap = new Map(
          rubricRows.map((row) => [
            normalizeCourseOutcomeCode(row.co_code),
            normalizeArticulationCell(row.rubric),
          ]),
        )
        const parsedRows = rows
          .map((row) => row.map((cell) => String(cell).trim()))
          .filter((row) => row[0] && !/course\s*outcome/i.test(row[0]))
          .map((row) => {
            const coCode = normalizeCourseOutcomeCode(row[0])

            return normalizeArticulationMatrixRow({
              co_code: row[0],
              attend: row[1],
              a1: row[2],
              a2: row[3],
              qt1: row[4],
              qt2: row[5],
              st1: row[6],
              st2: row[7],
              ct1: row[8],
              ct2: row[9],
              end_sem: rubricMap.get(coCode) ?? 0,
            })
          })

        if (!parsedRows.length) {
          throw new Error('No articulation rows found in the selected Excel file.')
        }

        setMatrixRows(parsedRows)
        setMessage(`${parsedRows.length} articulation rows imported.`)
      } catch (parseError) {
        setError(parseError.message)
      }
    }
    reader.onerror = () => setError('Unable to read selected Excel file.')
    reader.readAsArrayBuffer(file)
  }

  function downloadArticulationFormat() {
    const coRows = courseOutcomes.length
      ? courseOutcomes.map((outcome) => outcome.co_code)
      : ['CD-CO-1', 'CD-CO-2', 'CD-CO-3', 'CD-CO-4', 'CD-CO-5', 'CD-CO-6']
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['COURSE OUTCOME', 'INTERNAL ASSESSMENT', '', '', '', '', '', '', '', '', 'EXTERNAL ASSESSMENT'],
      [
        '',
        ...articulationAssessmentColumns.map((column) => column.label),
        ...articulationExternalColumns.map((column) => column.label),
      ],
      ...coRows.map((coCode) => [coCode, 3, 0, 0, 0, 0, 0, 0, 0, 0, 'Auto']),
    ])

    worksheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 0, c: 9 } },
      { s: { r: 0, c: 10 }, e: { r: 0, c: 10 } },
    ]
    worksheet['!cols'] = [{ wch: 18 }, ...articulationMatrixColumns.map(() => ({ wch: 10 }))]

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Articulation Matrix')
    XLSX.writeFile(workbook, 'articulation-matrix-format.xlsx')
  }

  function resetMatrix() {
    setMatrixRows((current) =>
      current.map((row) => ({
        ...row,
        ...Object.fromEntries(articulationAssessmentColumns.map((column) => [column.key, 0])),
      })),
    )
    setMessage('Articulation matrix reset.')
    setError('')
  }

  async function saveMatrix() {
    setMessage('')
    setError('')

    if (!selectedDepartment || !selectedProgramme || !selectedSemester || !selectedCourse) {
      setError('Select Department, Programme, Semester, and Course before saving.')
      return
    }

    if (!selection.academic_year) {
      setError('Academic Year is not configured for the selected Course Semester.')
      return
    }

    if (!matrixRows.length && !courseOutcomes.length) {
      setError('Import the articulation matrix Excel or select a course with Course Outcomes before saving.')
      return
    }

    setIsSaving(true)

    try {
      const rubricMap = new Map(
        rubricRows.map((row) => [normalizeCourseOutcomeCode(row.co_code), normalizeArticulationCell(row.rubric)]),
      )
      const courseOutcomeMap = new Map(
        courseOutcomes.map((outcome) => [normalizeCourseOutcomeCode(outcome.co_code), outcome]),
      )
      const rowsToSave = matrixRows.length
        ? matrixRows
        : courseOutcomes
            .sort((first, second) => first.co_code.localeCompare(second.co_code, undefined, { numeric: true }))
            .map((outcome) =>
              normalizeArticulationMatrixRow({
                co_code: outcome.co_code,
                end_sem: rubricMap.get(normalizeCourseOutcomeCode(outcome.co_code)) ?? 0,
              }),
            )
      const rows = rowsToSave.map((row) => {
        const normalizedCoCode = normalizeCourseOutcomeCode(row.co_code)
        const courseOutcome = courseOutcomeMap.get(normalizedCoCode)

        return {
          ...row,
          end_sem: rubricMap.get(normalizedCoCode) ?? normalizeArticulationCell(row.end_sem),
          department_id: Number(selection.department_id),
          programme_id: Number(selection.programme_id),
          semester_id: Number(selection.semester_id),
          course_id: Number(selection.course_id),
          co_id: courseOutcome?.co_id || null,
          academic_year: selection.academic_year,
          department_name: selectedDepartment.department_name,
          programme_name: selectedProgramme.programme_name,
          semester_name: selectedSemester.semester_name,
          course_code: selectedCourse.course_code,
          course_name: selectedCourse.course_name,
          co_statement: courseOutcome?.co_statement || '',
        }
      })
      const unmatchedRows = rows.filter((row) => !row.co_id)

      if (unmatchedRows.length) {
        throw new Error(
          `Course Outcome not found for: ${unmatchedRows
            .map((row) => row.co_code)
            .join(', ')}. Add matching Course Outcomes before saving.`,
        )
      }

      const response = await fetch('/api/articulation-matrix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id: Number(selection.course_id),
          academic_year: selection.academic_year,
          rows,
        }),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save articulation matrix.')
      }

      setMatrixRows(rows.map(normalizeArticulationMatrixRow))
      setMessage(data?.message || `${rowsToSave.length} articulation matrix rows saved.`)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="department-page co-po-page articulation-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Dashboard / Attainment / Articulation Matrix</p>
          <h3>Articulation Matrix</h3>
        </div>
        <button type="button" className="save-button" onClick={saveMatrix} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="mapping-selector-grid">
        <label>
          <span>Department</span>
          <select name="department_id" value={selection.department_id} onChange={updateSelection}>
            <option value="">Select Department</option>
            {departments.map((department) => (
              <option key={department.department_id} value={department.department_id}>
                {department.department_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Programme</span>
          <select name="programme_id" value={selection.programme_id} onChange={updateSelection}>
            <option value="">Select Programme</option>
            {filteredProgrammes.map((programme) => (
              <option key={programme.programme_id} value={programme.programme_id}>
                {programme.programme_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Semester</span>
          <select name="semester_id" value={selection.semester_id} onChange={updateSelection}>
            <option value="">Select Semester</option>
            {filteredSemesters.map((semester) => (
              <option key={semester.semester_id} value={semester.semester_id}>
                {semester.semester_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Course</span>
          <select name="course_id" value={selection.course_id} onChange={updateSelection}>
            <option value="">Select Course</option>
            {filteredCourses.map((course) => (
              <option key={course.course_id} value={course.course_id}>
                {course.course_code} - {course.course_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Import Excel</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={parseArticulationExcel} />
        </label>
      </div>

      {selection.course_id && <div className={`notice ${selection.academic_year ? 'success' : 'error'}`}>
        {selection.academic_year
          ? `Academic Year: ${selection.academic_year} (automatically selected from Course)`
          : 'Academic Year is not configured for the selected Course Semester.'}
      </div>}

      <div className="mapping-actions">
        <button type="button" className="action-button" onClick={downloadArticulationFormat}>
          Download Excel Format
        </button>
        <button type="button" className="reset-button" onClick={resetMatrix}>
          Reset
        </button>
      </div>

      {isLoading && <div className="notice success">Loading articulation matrix...</div>}
      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Internal Assessment Articulation</h4>
          <span>{matrixRows.length} course outcomes</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th rowSpan="2">COURSE OUTCOME</th>
                <th colSpan={articulationAssessmentColumns.length}>INTERNAL ASSESSMENT</th>
                <th colSpan={articulationExternalColumns.length}>EXTERNAL ASSESSMENT</th>
              </tr>
              <tr>
                {articulationMatrixColumns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row, rowIndex) => (
                <tr key={`${row.co_code}-${rowIndex}`}>
                  <td>
                    <strong>{row.co_code}</strong>
                  </td>
                  {articulationMatrixColumns.map((column) => (
                    <td key={column.key}>
                      {column.key === 'end_sem' ? (
                        <span className={`rubric-badge rubric-level-${row.end_sem || 0}`}>
                          {row.end_sem || 0}
                        </span>
                      ) : (
                        <MappingLevelInput
                          label={`${row.co_code} ${column.label}`}
                          value={row[column.key]}
                          onChange={(value) => updateMatrixCell(rowIndex, column.key, value)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {!matrixRows.length && !isLoading && (
                <tr>
                  <td colSpan={articulationMatrixColumns.length + 1} className="empty-cell">
                    Import the articulation matrix Excel format to preview and save values.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function UniversityMappingQuestionPage({ user }) {
  const defaultQuestionRows = useMemo(() => [
    { question_no: '1', sub_question: 'a', co_code: 'CO1', carrying_mark: 2 },
    { question_no: '1', sub_question: 'b', co_code: 'CO1', carrying_mark: 2 },
    { question_no: '1', sub_question: 'c', co_code: 'CO2', carrying_mark: 2 },
    { question_no: '1', sub_question: 'd', co_code: 'CO3', carrying_mark: 2 },
    { question_no: '1', sub_question: 'e', co_code: 'CO5', carrying_mark: 2 },
    { question_no: '2', sub_question: 'a', co_code: 'CO6', carrying_mark: 6 },
    { question_no: '2', sub_question: 'b', co_code: 'CO1', carrying_mark: 7 },
    { question_no: '2', sub_question: 'c', co_code: 'CO1', carrying_mark: 7 },
    { question_no: '2', sub_question: 'd', co_code: 'CO2', carrying_mark: 7 },
    { question_no: '2', sub_question: 'e', co_code: 'CO2', carrying_mark: 7 },
    { question_no: '3', sub_question: 'a', co_code: 'CO3', carrying_mark: 8 },
    { question_no: '3', sub_question: 'b', co_code: 'CO3', carrying_mark: 8 },
    { question_no: '3', sub_question: 'c', co_code: 'CO3', carrying_mark: 8 },
    { question_no: '3', sub_question: 'd', co_code: 'CO3', carrying_mark: 8 },
    { question_no: '3', sub_question: 'e', co_code: 'CO3', carrying_mark: 8 },
    { question_no: '4', sub_question: 'a', co_code: 'CO4', carrying_mark: 4 },
    { question_no: '4', sub_question: 'b', co_code: 'CO4', carrying_mark: 4 },
    { question_no: '4', sub_question: 'c', co_code: 'CO4', carrying_mark: 4 },
    { question_no: '4', sub_question: 'd', co_code: 'CO4', carrying_mark: 4 },
    { question_no: '5', sub_question: 'a', co_code: 'CO5', carrying_mark: 8 },
    { question_no: '5', sub_question: 'b', co_code: 'CO5', carrying_mark: 8 },
    { question_no: '6', sub_question: 'a', co_code: 'CO6', carrying_mark: 5 },
    { question_no: '6', sub_question: 'b', co_code: 'CO6', carrying_mark: 5 },
    { question_no: '6', sub_question: 'c', co_code: 'CO6', carrying_mark: 5 },
    { question_no: '6', sub_question: 'd', co_code: 'CO6', carrying_mark: 5 },
    { question_no: '6', sub_question: 'e', co_code: 'CO6', carrying_mark: 5 },
    { question_no: '6', sub_question: 'f', co_code: 'CO6', carrying_mark: 5 },
    { question_no: '6', sub_question: 'g', co_code: 'CO6', carrying_mark: 5 },
    { question_no: '6', sub_question: 'h', co_code: 'CO6', carrying_mark: 5 },
  ], [])
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [questionRows, setQuestionRows] = useState([])
  const [selection, setSelection] = useState({
    department_id: '',
    programme_id: '',
    semester_id: '',
    course_id: '',
    academic_year: '2024-25',
    exam_type: 'Regular',
    exam_month: 'April',
    exam_year: '2025',
    total_marks: 156,
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const isUserLogin = user?.role !== 'Admin'

  const filteredProgrammes = useMemo(
    () =>
      programmes.filter(
        (programme) => String(programme.department_id) === selection.department_id,
      ),
    [programmes, selection.department_id],
  )
  const filteredSemesters = useMemo(
    () =>
      semesters.filter(
        (semester) =>
          String(semester.department_id) === selection.department_id &&
          String(semester.programme_id) === selection.programme_id,
      ),
    [semesters, selection.department_id, selection.programme_id],
  )
  const filteredCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          String(course.department_id) === selection.department_id &&
          String(course.programme_id) === selection.programme_id &&
          String(course.semester_id) === selection.semester_id,
      ),
    [courses, selection.department_id, selection.programme_id, selection.semester_id],
  )
  const totalMarks = Number(selection.total_marks) || 0
  const totalMappedMarks = questionRows.reduce(
    (total, row) => total + Number(row.carrying_mark || 0),
    0,
  )
  const coSummaryRows = useMemo(() => {
    const groupedRows = questionRows.reduce((summary, row) => {
      const coCode = row.co_code || 'CO'
      const current = summary[coCode] || { co: coCode, count: 0, mark: 0, rubric: 1 }
      current.count += 1
      current.mark += Number(row.carrying_mark || 0)
      summary[coCode] = current
      return summary
    }, {})

    const rows = Object.values(groupedRows)
    const highestMark = Math.max(0, ...rows.map((row) => row.mark))
    const levelThreeMark = highestMark * (2 / 3)
    const levelTwoMark = highestMark * (1 / 3)

    return rows.map((row) => ({
      ...row,
      rubric: highestMark <= 0 ? 1 : row.mark >= levelThreeMark ? 3 : row.mark >= levelTwoMark ? 2 : 1,
    })).sort((first, second) =>
      first.co.localeCompare(second.co, undefined, { numeric: true }),
    )
  }, [questionRows])
  const highestCoMark = Math.max(0, ...coSummaryRows.map((row) => row.mark))
  const rubricLevelThreeMark = highestCoMark * (2 / 3)
  const rubricLevelTwoMark = highestCoMark * (1 / 3)
  const displayRubricMark = (value) => Number(value).toFixed(2)

  useEffect(() => {
    async function loadMasters() {
      setIsLoading(true)
      setError('')

      try {
        const responses = await Promise.all([
          fetch('/api/departments'),
          fetch('/api/programmes'),
          fetch('/api/semesters'),
          fetch('/api/courses'),
        ])
        const data = await Promise.all(responses.map((response) => readResponseJson(response)))

        responses.forEach((response, index) => {
          if (!response.ok) {
            throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load master data.')
          }
        })

        setDepartments(data[0] || [])
        setProgrammes(data[1] || [])
        setSemesters(data[2] || [])
        setCourses(data[3] || [])
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadMasters()
  }, [])

  function updateSelection(event) {
    const { name, value } = event.target

    setSelection((current) => {
      const next = { ...current, [name]: value }

      if (name === 'department_id') {
        next.programme_id = ''
        next.semester_id = ''
        next.course_id = ''
      }

      if (name === 'programme_id') {
        next.semester_id = ''
        next.course_id = ''
      }

      if (name === 'semester_id') {
        next.course_id = ''
      }

      return next
    })
    setQuestionRows([])
    setMessage('')
    setError('')
  }

  function paperPayload(rows = questionRows) {
    return {
      ...selection,
      department_id: Number(selection.department_id),
      programme_id: Number(selection.programme_id),
      semester_id: Number(selection.semester_id),
      course_id: Number(selection.course_id),
      exam_year: Number(selection.exam_year),
      total_marks: Number(selection.total_marks),
      rows,
    }
  }

  function validateSelection() {
    if (
      !selection.department_id ||
      !selection.programme_id ||
      !selection.semester_id ||
      !selection.course_id ||
      !selection.academic_year ||
      !selection.exam_type ||
      !selection.exam_month ||
      !selection.exam_year ||
      !selection.total_marks
    ) {
      throw new Error('Select paper context before loading question mapping.')
    }
  }

  function normalizeQuestionMappingRows(rows) {
    return rows.map((row) => ({
      question_mapping_id: row.question_mapping_id,
      question_no: row.question_no,
      sub_question: row.sub_question,
      co_code: row.co_code,
      carrying_mark: Number(row.carrying_mark),
    }))
  }

  async function saveQuestionPaper(rows = questionRows) {
    const response = await fetch('/api/university-question-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paperPayload(rows)),
    })
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to save question mapping.')
    }

    return data
  }

  useEffect(() => {
    async function loadSavedQuestionMapping() {
      if (
        !selection.department_id ||
        !selection.programme_id ||
        !selection.semester_id ||
        !selection.course_id ||
        !selection.academic_year ||
        !selection.exam_type ||
        !selection.exam_month ||
        !selection.exam_year
      ) {
        return
      }

      setIsLoading(true)
      setError('')

      try {
        const query = new URLSearchParams({
          department_id: selection.department_id,
          programme_id: selection.programme_id,
          semester_id: selection.semester_id,
          course_id: selection.course_id,
          academic_year: selection.academic_year,
          exam_type: selection.exam_type,
          exam_month: selection.exam_month,
          exam_year: selection.exam_year,
        })
        const response = await fetch(`/api/university-question-mapping?${query}`)
        const data = await readResponseJson(response)

        if (!response.ok) {
          throw new Error(data?.detail || data?.error || 'Unable to load question mapping.')
        }

        if (data?.length) {
          setQuestionRows(normalizeQuestionMappingRows(data))
          setMessage(`${data.length} saved question mapping rows loaded.`)
        } else {
          setQuestionRows(isUserLogin ? [] : defaultQuestionRows)
          setMessage(isUserLogin
            ? 'No saved mapping found. No question mapping data is available.'
            : 'No saved mapping found. Default question mapping rows are ready to save.')
        }
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadSavedQuestionMapping()
  }, [
    selection.department_id,
    selection.programme_id,
    selection.semester_id,
    selection.course_id,
    selection.academic_year,
    selection.exam_type,
    selection.exam_month,
    selection.exam_year,
    defaultQuestionRows,
    isUserLogin,
  ])

  async function saveUniversityQuestionMapping() {
    setIsSaving(true)
    setMessage('')
    setError('')

    try {
      validateSelection()
      const rowsToSave = questionRows.length ? questionRows : defaultQuestionRows
      const data = await saveQuestionPaper(rowsToSave)
      setQuestionRows(rowsToSave)
      setMessage(data?.message || `${rowsToSave.length} question mapping rows saved to database.`)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  function deleteQuestionRow(index) {
    setQuestionRows((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  function downloadQuestionMappingFormat() {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['QUESTION NO', 'BITWISW', 'MAPPING WITH COs', 'CARRYING MARK'],
      ['1.', 'a)', '', ''],
      ['', 'b)', '', ''],
      ['', 'c)', '', ''],
      ['', 'd)', '', ''],
      ['', 'e)', '', ''],
      ['', 'f)', '', ''],
      ['', 'g)', '', ''],
      ['', 'h)', '', ''],
      ['', 'i)', '', ''],
      ['', 'j)', '', ''],
      ['2.', 'a)', '', ''],
      ['', 'b)', '', ''],
      ['', 'c)', '', ''],
      ['', 'd)', '', ''],
      ['', 'e)', '', ''],
      ['', 'f)', '', ''],
      ['', 'g)', '', ''],
      ['', 'h)', '', ''],
      ['', 'i)', '', ''],
      ['', 'j)', '', ''],
      ['', 'k)', '', ''],
      ['', 'l)', '', ''],
      ['3.', 'a)', '', ''],
      ['', 'b)', '', ''],
      ['4.', '', '', ''],
      ['5.', 'a)', '', ''],
      ['', 'b)', '', ''],
      ['6.', 'a)', '', ''],
      ['', 'b)', '', ''],
    ])
    worksheet['!ref'] = 'A1:D30'
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Question Mapping')
    XLSX.writeFile(workbook, 'university-question-mapping-format.xlsx')
  }

  async function uploadQuestionMappingExcel(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setIsUploading(true)
    setMessage('')
    setError('')

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const parsedRows = []
      let lastQuestionNo = ''

      rows.forEach((row, index) => {
        const questionNo = String(
          getSheetValue(row, ['questionno', 'qno', 'question']) || lastQuestionNo,
        ).replace(/\.$/, '').trim()
        const subQuestion = String(
          getSheetValue(row, ['bitwisw', 'bitwise', 'subq', 'subquestion', 'subquestionno']),
        ).replace(/\)$/g, '').trim()
        const coCode = String(
          getSheetValue(row, ['mappingwithcos', 'mappingwithco', 'co', 'cocode']),
        ).trim().toUpperCase()
        const carryingMark =
          Number(getSheetValue(row, ['carryingmark', 'mark', 'marks'])) || 0

        if (questionNo) {
          lastQuestionNo = questionNo
        }

        if (!questionNo || !coCode) {
          return
        }

        parsedRows.push({
          question_no: questionNo,
          sub_question: subQuestion || '-',
          co_code: coCode,
          carrying_mark: carryingMark,
        })
      })

      if (!parsedRows.length) {
        throw new Error('No valid rows found. Expected columns: QUESTION NO, BITWISW, MAPPING WITH COs, CARRYING MARK.')
      }

      setQuestionRows(parsedRows)

      try {
        validateSelection()
        await saveQuestionPaper(parsedRows)
        setMessage(`${parsedRows.length} question mapping rows imported and saved to database.`)
      } catch (saveError) {
        setMessage(`${parsedRows.length} question mapping rows imported. Select paper context, then Save Question Paper.`)
      }
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <section className="department-page co-po-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Dashboard / External Exam / University Question Mapping</p>
          <h3>University Question Mapping</h3>
        </div>
      </div>

      <div className="mapping-selector-grid">
        <label>
          <span>Department</span>
          <select name="department_id" value={selection.department_id} onChange={updateSelection}>
            <option value="">Select Department</option>
            {departments.map((department) => (
              <option key={department.department_id} value={department.department_id}>
                {department.department_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Programme</span>
          <select name="programme_id" value={selection.programme_id} onChange={updateSelection}>
            <option value="">Select Programme</option>
            {filteredProgrammes.map((programme) => (
              <option key={programme.programme_id} value={programme.programme_id}>
                {programme.programme_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Semester</span>
          <select name="semester_id" value={selection.semester_id} onChange={updateSelection}>
            <option value="">Select Semester</option>
            {filteredSemesters.map((semester) => (
              <option key={semester.semester_id} value={semester.semester_id}>
                {semester.semester_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Course</span>
          <select name="course_id" value={selection.course_id} onChange={updateSelection}>
            <option value="">Select Course</option>
            {filteredCourses.map((course) => (
              <option key={course.course_id} value={course.course_id}>
                {course.course_code} - {course.course_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Academic Year</span>
          <select name="academic_year" value={selection.academic_year} onChange={updateSelection}>
            <option>2024-25</option>
            <option>2025-26</option>
          </select>
        </label>
      </div>

      <div className="mapping-actions">
        <label className="file-action">
          {isUploading ? 'Uploading...' : 'Upload Excel'}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={uploadQuestionMappingExcel}
            disabled={isUploading || isSaving}
          />
        </label>
        <button type="button" className="reset-button" onClick={downloadQuestionMappingFormat}>
          Excel Format
        </button>
      </div>

      {isLoading && <div className="notice success">Loading master data...</div>}
      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Question Paper Mapping</h4>
          <span>{questionRows.length} questions shown</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Q.No</th>
                <th>Sub Q.</th>
                <th>Mapping with CO</th>
                <th>Carrying Mark</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {questionRows.map((row, index) => (
                <tr key={`${row.question_no}-${row.sub_question}-${index}`}>
                  <td>{row.question_no}</td>
                  <td>{row.sub_question}</td>
                  <td>{row.co_code}</td>
                  <td>{row.carrying_mark}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button">Edit</button>
                      <button type="button" onClick={() => deleteQuestionRow(index)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!questionRows.length && (
                <tr>
                  <td colSpan="5" className="empty-cell">
                    Create or load a question paper to display mapping rows.
                  </td>
                </tr>
              )}
              {questionRows.length > 0 && <tr className="summary-row">
                <td colSpan="3">Total Mapped Marks</td>
                <td>{totalMappedMarks} / {totalMarks}</td>
                <td></td>
              </tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-panel">
        <div className="table-heading">
          <h4>CO Summary and Rubric Mapping</h4>
          <span>{coSummaryRows.length} CO records</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>CO</th>
                <th>No. of COs</th>
                <th>Mark</th>
                <th>Rubric Mapping</th>
              </tr>
            </thead>
            <tbody>
              {coSummaryRows.map((row) => (
                <tr key={row.co}>
                  <td>{row.co}</td>
                  <td>{row.count}</td>
                  <td>{row.mark}</td>
                  <td>
                    <span className={`rubric-badge rubric-level-${row.rubric}`}>
                      {row.rubric}
                    </span>
                  </td>
                </tr>
              ))}
              {!coSummaryRows.length && <tr><td colSpan="4" className="empty-cell">No CO summary or rubric mapping data found.</td></tr>}
              {coSummaryRows.length > 0 && <tr className="summary-row">
                <td>TOTAL</td>
                <td></td>
                <td>{totalMappedMarks}</td>
                <td></td>
              </tr>}
            </tbody>
          </table>
        </div>
        {coSummaryRows.length > 0 && (
          <div className="rubric-note">
            <strong>Rubric Calculation</strong>
            <p>
              In this mapping, the highest mark is {highestCoMark} with rubric mapping assigned as 3.
              Assigned mark for Level 3 = ({highestCoMark} / 3) x 2 = {displayRubricMark(rubricLevelThreeMark)} mark.
              Assigned mark for Level 2 = ({highestCoMark} / 3) x 1 = {displayRubricMark(rubricLevelTwoMark)} mark.
            </p>
            <p>
              If Mark &lt; {highestCoMark} and Mark &gt;= {displayRubricMark(rubricLevelThreeMark)}, assign 3.
              If Mark &lt; {displayRubricMark(rubricLevelThreeMark)} and Mark &gt;= {displayRubricMark(rubricLevelTwoMark)}, assign 2.
              If Mark &lt; {displayRubricMark(rubricLevelTwoMark)}, assign 1.
            </p>
          </div>
        )}
        <div className="page-last-actions">
          <button
            type="button"
            className="save-button"
            onClick={saveUniversityQuestionMapping}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </section>
  )
}

function StudentMasterPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [admissionBatches, setAdmissionBatches] = useState([])
  const [selection, setSelection] = useState({
    department_id: '',
    programme_id: '',
    batch: '',
  })
  const emptyStudent = { registration_no: '', student_name: '', status: 'Active' }
  const [student, setStudent] = useState(emptyStudent)
  const [savedStudents, setSavedStudents] = useState([])
  const [pendingStudents, setPendingStudents] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const filteredProgrammes = useMemo(
    () => programmes.filter((programme) => String(programme.department_id) === selection.department_id),
    [programmes, selection.department_id],
  )
  const filteredAdmissionBatches = useMemo(
    () => admissionBatches.filter((batch) =>
      (!selection.department_id || String(batch.department_id) === selection.department_id) &&
      (!selection.programme_id || String(batch.programme_id) === selection.programme_id)),
    [admissionBatches, selection.department_id, selection.programme_id],
  )
  const visibleStudents = pendingStudents.length ? pendingStudents : savedStudents
  const selectedDepartmentName =
    departments.find((department) => String(department.department_id) === selection.department_id)
      ?.department_name || 'selected department'

  useEffect(() => {
    async function loadMasters() {
      setIsLoading(true)
      setError('')

      try {
        const responses = await Promise.all([
          fetch('/api/departments'),
          fetch('/api/programmes'),
          fetch('/api/admission-batches'),
        ])
        const data = await Promise.all(responses.map((response) => readResponseJson(response)))

        responses.forEach((response, index) => {
          if (!response.ok) {
            throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load student master data.')
          }
        })

        setDepartments(data[0] || [])
        setProgrammes(data[1] || [])
        setAdmissionBatches(data[2] || [])
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadMasters()
  }, [])

  useEffect(() => {
    async function loadStudents() {
      if (!selection.department_id || !selection.programme_id) {
        setSavedStudents([])
        return
      }

      try {
        const query = new URLSearchParams(selection)
        const response = await fetch(`/api/students?${query}`)
        const data = await readResponseJson(response)

        if (!response.ok) {
          throw new Error(data?.detail || data?.error || 'Unable to load students.')
        }

        setSavedStudents(data || [])
      } catch (loadError) {
        setError(loadError.message)
      }
    }

    loadStudents()
  }, [selection])

  function updateSelection(event) {
    const { name, value } = event.target

    setSelection((current) => {
      const next = { ...current, [name]: value }

      if (name === 'department_id') {
        next.programme_id = ''
        next.batch = ''
      }

      if (name === 'programme_id') {
        next.batch = ''
      }

      return next
    })
    setMessage('')
    setError('')
    setPendingStudents([])
  }

  function validateStudentContext() {
    if (!selection.department_id || !selection.programme_id || !selection.batch) {
      throw new Error('Select Department, Programme, and Batch before saving students.')
    }
  }

  async function saveStudentRows(rows, replaceExisting = false) {
    const response = await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...selection,
        department_id: Number(selection.department_id),
        programme_id: Number(selection.programme_id),
        replace_existing: replaceExisting,
        rows,
      }),
    })
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to save students.')
    }

    return data
  }

  async function refreshStudents() {
    const query = new URLSearchParams(selection)
    const response = await fetch(`/api/students?${query}`)
    const data = await readResponseJson(response)

    if (!response.ok) {
      throw new Error(data?.detail || data?.error || 'Unable to refresh students.')
    }

    setSavedStudents(data || [])
  }

  async function savePendingStudents() {
    setIsSaving(true)
    setMessage('')
    setError('')

    try {
      validateStudentContext()

      if (!pendingStudents.length) {
        throw new Error('Upload Excel before saving students.')
      }

      await saveStudentRows(pendingStudents, true)
      setPendingStudents([])
      await refreshStudents()
      setMessage(`${pendingStudents.length} student rows saved departmentwise for ${selectedDepartmentName}.`)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  function updateStudent(event) {
    const { name, value } = event.target
    setStudent((current) => ({ ...current, [name]: value }))
    setMessage('')
    setError('')
  }

  function resetStudentForm() {
    setStudent(emptyStudent)
    setPendingStudents([])
    setMessage('')
    setError('')
  }

  async function saveStudent() {
    setIsSaving(true)
    setMessage('')
    setError('')

    try {
      validateStudentContext()
      if (!student.registration_no.trim() || !student.student_name.trim()) {
        throw new Error('Registration No and Student Name are required.')
      }
      await saveStudentRows([student])
      await refreshStudents()
      setStudent(emptyStudent)
      setMessage('Student saved successfully in the database.')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  function downloadStudentExcelFormat() {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Registration No', 'Student Name', 'Status'],
      ['22012001', 'CHIRANJEEB NAYAK', 'Active'],
    ])
    worksheet['!ref'] = 'A1:C2'
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Students')
    XLSX.writeFile(workbook, 'student-master-format.xlsx')
  }

  async function uploadStudentExcel(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setIsUploading(true)
    setMessage('')
    setError('')

    try {
      validateStudentContext()
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const sheetRows = XLSX.utils.sheet_to_json(sheet, {
        blankrows: false,
        defval: '',
        header: 1,
      })
      const registrationHeaders = [
        'registrationno',
        'registrationnumber',
        'regdno',
        'regdnumber',
        'regno',
        'regnumber',
        'registration',
      ]
      const universityHeaders = [
        'universityregd',
        'universityregdno',
        'universityregistration',
        'universityregistrationno',
        'universityregno',
        'universityrollno',
      ]
      const nameHeaders = ['studentname', 'studentsname', 'nameofstudent', 'name']
      const statusHeaders = ['status']
      const headerIndex = sheetRows.findIndex((row) => {
        const normalizedRow = row.map(normalizeHeader)
        return (
          normalizedRow.some((header) => registrationHeaders.includes(header)) &&
          normalizedRow.some((header) => nameHeaders.includes(header))
        )
      })

      if (headerIndex === -1) {
        const detectedColumns = sheetRows[0]?.filter(Boolean).join(', ') || 'none'
        throw new Error(`Student Excel columns not found. Required columns: Registration No and Student Name. Detected columns: ${detectedColumns}.`)
      }

      const headers = sheetRows[headerIndex].map(normalizeHeader)
      const columnIndex = (names) => headers.findIndex((header) => names.includes(header))
      const registrationIndex = columnIndex(registrationHeaders)
      const universityIndex = columnIndex(universityHeaders)
      const nameIndex = columnIndex(nameHeaders)
      const statusIndex = columnIndex(statusHeaders)
      const parsedRows = sheetRows
        .slice(headerIndex + 1)
        .map((row) => {
          const registrationNo = String(row[registrationIndex] || '').trim()
          const universityRegd = universityIndex >= 0 ? String(row[universityIndex] || '').trim() : ''
          const studentName = String(row[nameIndex] || '').trim()

          return {
            registration_no: registrationNo || universityRegd,
            university_regd: universityRegd,
            student_name: studentName,
            status: statusIndex >= 0 ? String(row[statusIndex] || 'Active').trim() : 'Active',
          }
        })
        .filter((row) => row.registration_no && row.student_name)

      if (!parsedRows.length) {
        throw new Error('Student Excel format is correct, but no filled student rows were found. Add Registration No and Student Name below the header row.')
      }

      setPendingStudents(parsedRows)
      setMessage(`${parsedRows.length} student rows loaded for ${selectedDepartmentName}. Click Save to store departmentwise.`)
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <section className="department-page co-po-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Student Master</p>
          <h3>Student Master</h3>
        </div>
      </div>

      <div className="department-form student-master-form">
        <label>
          <span>Department</span>
          <select name="department_id" value={selection.department_id} onChange={updateSelection}>
            <option value="">Select Department</option>
            {departments.map((department) => (
              <option key={department.department_id} value={department.department_id}>
                {department.department_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Programme</span>
          <select name="programme_id" value={selection.programme_id} onChange={updateSelection}>
            <option value="">Select Programme</option>
            {filteredProgrammes.map((programme) => (
              <option key={programme.programme_id} value={programme.programme_id}>
                {programme.programme_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Batch</span>
          <select name="batch" value={selection.batch} onChange={updateSelection}>
            <option value="">Select Batch</option>
            {filteredAdmissionBatches.map((batch) => (
              <option key={batch.admission_batch_id} value={batch.batch_code}>{batch.batch_code}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="table-panel student-details-panel">
        <div className="table-heading"><h4>Student Details</h4></div>
        <div className="department-form student-master-form">
          <label>
            <span>Registration No</span>
            <input name="registration_no" value={student.registration_no} onChange={updateStudent} placeholder="22012001" />
          </label>
          <label>
            <span>Student Name</span>
            <input name="student_name" value={student.student_name} onChange={updateStudent} placeholder="CHIRANJEEB NAYAK" />
          </label>
          <label>
            <span>Status</span>
            <select name="status" value={student.status} onChange={updateStudent}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </label>

          <div className="form-actions">
          <button type="button" className="save-button" onClick={pendingStudents.length ? savePendingStudents : saveStudent} disabled={isSaving || isUploading}>
            {isSaving ? 'Saving...' : pendingStudents.length ? `Save ${pendingStudents.length} Students` : 'Save Student'}
          </button>
          <button type="button" className="reset-button" onClick={resetStudentForm} disabled={isSaving || isUploading}>Reset</button>
          <label className="file-action">
            {isUploading ? 'Uploading...' : 'Upload Excel'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={uploadStudentExcel}
              disabled={isUploading || isSaving}
            />
          </label>
          <button type="button" className="reset-button" onClick={downloadStudentExcelFormat}>
            Excel Format
          </button>
          <span className="form-status">Excel rows are previewed below; save them to store in the database.</span>
          </div>
        </div>
      </div>

      {isLoading && <div className="notice success">Loading student master data...</div>}
      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Students</h4>
          <span>{visibleStudents.length} records</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Registration No</th>
                <th>Student Name</th>
                <th>Batch</th>
                <th>Academic Year</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map((row, index) => (
                <tr key={row.student_id || `${row.registration_no}-${index}`}>
                  <td>{row.registration_no}</td>
                  <td>{row.student_name}</td>
                  <td>{row.batch || selection.batch}</td>
                  <td>{row.academic_year || selection.academic_year}</td>
                  <td>
                    <span className={`status-pill ${row.status === 'Inactive' ? 'inactive' : ''}`}>
                      {row.status || 'Active'}
                    </span>
                  </td>
                </tr>
              ))}
              {!visibleStudents.length && (
                <tr>
                  <td colSpan="5" className="empty-cell">
                    Select student context or upload Excel to display student records.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function StudentCourseFacultyMappingPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [faculty, setFaculty] = useState([])
  const [admissionBatches, setAdmissionBatches] = useState([])
  const [students, setStudents] = useState([])
  const [selectedStudentIds, setSelectedStudentIds] = useState([])
  const [selection, setSelection] = useState({ department_id: '', programme_id: '', admission_batch_id: '', academic_year: '', semester_id: '', course_id: '', faculty_id: '', section: 'A' })
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const filteredProgrammes = programmes.filter((row) => String(row.department_id) === selection.department_id)
  const selectedEnrollmentBatch = admissionBatches.find((row) => String(row.admission_batch_id) === selection.admission_batch_id)
  const selectedStudyYearIndex = selection.academic_year && selectedEnrollmentBatch
    ? Number(selection.academic_year.slice(0, 4)) - Number(selectedEnrollmentBatch.admission_year)
    : -1
  const firstSemesterNumber = selectedStudyYearIndex >= 0 ? selectedStudyYearIndex * 2 + 1 : 0
  const filteredSemesters = semesters.filter((row) =>
    String(row.department_id) === selection.department_id &&
    String(row.programme_id) === selection.programme_id &&
    (!selection.admission_batch_id || String(row.admission_batch_id) === selection.admission_batch_id) &&
    (!firstSemesterNumber || [firstSemesterNumber, firstSemesterNumber + 1].includes(Number(row.semester_number))))
  const filteredCourses = courses.filter((row) => String(row.department_id) === selection.department_id && String(row.programme_id) === selection.programme_id && String(row.semester_id) === selection.semester_id)
  const filteredAdmissionBatches = admissionBatches.filter((row) => String(row.department_id) === selection.department_id && String(row.programme_id) === selection.programme_id)
  const enrollmentAcademicYears = (() => {
    const batch = admissionBatches.find((row) => String(row.admission_batch_id) === selection.admission_batch_id)
    const admissionYear = Number(batch?.admission_year || 0)
    const studyYears = Math.ceil(Number(batch?.total_semesters || 0) / 2)
    return admissionYear && studyYears
      ? Array.from({ length: studyYears }, (_, index) => `${admissionYear + index}-${String(admissionYear + index + 1).slice(-2)}`)
      : []
  })()
  const activeFaculty = faculty.filter((row) => row.status !== 'Inactive')
  const departmentFaculty = activeFaculty.filter((row) => String(row.department_id) === selection.department_id)
  const filteredFaculty = departmentFaculty.length ? departmentFaculty : activeFaculty

  useEffect(() => {
    Promise.all(['/api/departments', '/api/programmes', '/api/semesters', '/api/courses', '/api/faculty-management', '/api/admission-batches'].map(async (url) => {
      const response = await fetch(url)
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load enrollment master data.')
      return data
    })).then(([departmentRows, programmeRows, semesterRows, courseRows, facultyRows, admissionBatchRows]) => {
      setDepartments(departmentRows || [])
      setProgrammes(programmeRows || [])
      setSemesters(semesterRows || [])
      setCourses(courseRows || [])
      setFaculty(facultyRows || [])
      setAdmissionBatches(admissionBatchRows || [])
    }).catch((loadError) => setError(loadError.message))
  }, [])

  function updateSelection(event) {
    const { name, value } = event.target
    setSelection((current) => {
      const next = { ...current, [name]: value }
      if (name === 'department_id') Object.assign(next, { programme_id: '', admission_batch_id: '', academic_year: '', semester_id: '', course_id: '', faculty_id: '' })
      if (name === 'programme_id') Object.assign(next, { admission_batch_id: '', academic_year: '', semester_id: '', course_id: '' })
      if (name === 'admission_batch_id') {
        const batch = admissionBatches.find((row) => String(row.admission_batch_id) === value)
        next.academic_year = batch ? `${batch.admission_year}-${String(Number(batch.admission_year) + 1).slice(-2)}` : ''
      }
      if (name === 'admission_batch_id' || name === 'academic_year') {
        const batch = admissionBatches.find((row) => String(row.admission_batch_id) === next.admission_batch_id)
        const studyYearIndex = batch && next.academic_year
          ? Number(next.academic_year.slice(0, 4)) - Number(batch.admission_year)
          : -1
        const semesterStart = studyYearIndex >= 0 ? studyYearIndex * 2 + 1 : 0
        const matchingSemesters = semesters
          .filter((row) => String(row.admission_batch_id) === next.admission_batch_id && [semesterStart, semesterStart + 1].includes(Number(row.semester_number)))
          .sort((first, second) => Number(first.semester_number) - Number(second.semester_number))
        next.semester_id = matchingSemesters[0] ? String(matchingSemesters[0].semester_id) : ''
        const matchingCourses = courses.filter((row) => String(row.semester_id) === next.semester_id)
        next.course_id = matchingCourses[0] ? String(matchingCourses[0].course_id) : ''
      }
      if (name === 'semester_id') {
        const matchingCourses = courses.filter((row) => String(row.semester_id) === value)
        next.course_id = matchingCourses[0] ? String(matchingCourses[0].course_id) : ''
      }
      return next
    })
    setStudents([])
    setSelectedStudentIds([])
    setMessage('')
    setError('')
  }

  function validateSelection() {
    const missing = Object.entries(selection).find(([, value]) => !value)
    if (missing) throw new Error('Select Department, Programme, Admission Year, Academic Year, Semester, Course, and Faculty.')
  }

  async function loadStudents() {
    setIsLoading(true)
    setMessage('')
    setError('')
    try {
      validateSelection()
      const studentQuery = new URLSearchParams({ department_id: selection.department_id, programme_id: selection.programme_id, section: selection.section })
      const enrollmentQuery = new URLSearchParams({ course_id: selection.course_id, faculty_id: selection.faculty_id, academic_year: selection.academic_year, section: selection.section })
      const [studentResponse, enrollmentResponse] = await Promise.all([fetch(`/api/students?${studentQuery}`), fetch(`/api/student-course-enrollments?${enrollmentQuery}`)])
      const [studentRows, enrollmentRows] = await Promise.all([readResponseJson(studentResponse), readResponseJson(enrollmentResponse)])
      if (!studentResponse.ok) throw new Error(studentRows?.detail || studentRows?.error || 'Unable to load students.')
      if (!enrollmentResponse.ok) throw new Error(enrollmentRows?.detail || enrollmentRows?.error || 'Unable to load enrollments.')
      setStudents(studentRows || [])
      setSelectedStudentIds((enrollmentRows || []).map((row) => Number(row.student_id)))
      setMessage(`${studentRows?.length || 0} students loaded.`)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  function toggleStudent(studentId) {
    setSelectedStudentIds((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId])
  }

  function toggleAllStudents() {
    const allStudentIds = students.map((row) => Number(row.student_id))
    const allSelected = allStudentIds.length > 0 && allStudentIds.every((studentId) => selectedStudentIds.includes(studentId))
    setSelectedStudentIds(allSelected ? [] : allStudentIds)
  }

  async function saveEnrollments() {
    setIsSaving(true)
    setMessage('')
    setError('')
    try {
      validateSelection()
      const response = await fetch('/api/student-course-enrollments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ course_id: Number(selection.course_id), faculty_id: Number(selection.faculty_id), academic_year: selection.academic_year, section: selection.section, student_ids: selectedStudentIds }) })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to save enrollments.')
      setMessage(data.message)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="department-page co-po-page">
      <div className="section-title"><div><p className="eyebrow">Student Course Enrollment</p><h3>Student Course Enrollment</h3></div></div>
      <div className="department-form student-master-form">
        <label><span>Department</span><select name="department_id" value={selection.department_id} onChange={updateSelection}><option value="">Select Department</option>{departments.map((row) => <option key={row.department_id} value={row.department_id}>{row.department_code || row.department_name}</option>)}</select></label>
        <label><span>Programme</span><select name="programme_id" value={selection.programme_id} onChange={updateSelection}><option value="">Select Programme</option>{filteredProgrammes.map((row) => <option key={row.programme_id} value={row.programme_id}>{row.programme_name}</option>)}</select></label>
        <label><span>Admission Year</span><select name="admission_batch_id" value={selection.admission_batch_id} onChange={updateSelection}><option value="">Select Admission Year</option>{filteredAdmissionBatches.map((row) => <option key={row.admission_batch_id} value={row.admission_batch_id}>{row.admission_year}</option>)}</select></label>
        <label><span>Academic Year</span><select name="academic_year" value={selection.academic_year} onChange={updateSelection}><option value="">Select Academic Year</option>{enrollmentAcademicYears.map((year) => <option key={year}>{year}</option>)}</select></label>
        <label><span>Semester</span><select name="semester_id" value={selection.semester_id} onChange={updateSelection}><option value="">Select Semester</option>{filteredSemesters.map((row) => <option key={row.semester_id} value={row.semester_id}>{row.semester_name || `${row.semester_no} Semester`}</option>)}</select></label>
        <label><span>Course</span><select name="course_id" value={selection.course_id} onChange={updateSelection}><option value="">Select Course</option>{filteredCourses.map((row) => <option key={row.course_id} value={row.course_id}>{row.course_code} - {row.course_name}</option>)}</select></label>
        <label><span>Faculty</span><select name="faculty_id" value={selection.faculty_id} onChange={updateSelection}><option value="">Select Faculty</option>{filteredFaculty.map((row) => <option key={row.faculty_id} value={row.faculty_id}>{row.faculty_name}{departmentFaculty.length ? '' : row.department_code ? ` (${row.department_code})` : ''}</option>)}</select></label>
        <div className="form-actions"><button type="button" className="save-button" onClick={loadStudents} disabled={isLoading}>{isLoading ? 'Loading...' : 'Load Students'}</button></div>
      </div>
      {(message || error) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || message}</div>}
      <div className="table-panel">
        <div className="table-heading"><h4>Student Enrollment</h4><span>{selectedStudentIds.length} of {students.length} selected</span></div>
        <div className="table-wrap"><table><thead><tr><th><label className="table-checkbox-label"><input type="checkbox" checked={students.length > 0 && students.every((row) => selectedStudentIds.includes(Number(row.student_id)))} onChange={toggleAllStudents} disabled={!students.length} /> Select All</label></th><th>Registration No</th><th>Student Name</th><th>Status</th></tr></thead><tbody>
          {students.map((row) => <tr key={row.student_id}><td><input type="checkbox" checked={selectedStudentIds.includes(Number(row.student_id))} onChange={() => toggleStudent(Number(row.student_id))} /></td><td>{row.registration_no}</td><td>{row.student_name}</td><td>{row.status}</td></tr>)}
          {!students.length && <tr><td colSpan="4" className="empty-cell">Select the mapping details and click Load Students.</td></tr>}
        </tbody></table></div>
        {students.length > 0 && <div className="form-actions"><button type="button" className="save-button" onClick={saveEnrollments} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Enrollment'}</button></div>}
      </div>
    </section>
  )
}

function MarkAttainmentPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [selection, setSelection] = useState({
    department_id: '',
    programme_id: '',
    semester_id: '',
    course_id: '',
    academic_year: '',
  })
  const [internalRows, setInternalRows] = useState([])
  const [internalHistoryRows, setInternalHistoryRows] = useState([])
  const [externalRows, setExternalRows] = useState([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const filteredProgrammes = useMemo(
    () =>
      programmes.filter(
        (programme) => String(programme.department_id) === selection.department_id,
      ),
    [programmes, selection.department_id],
  )
  const filteredSemesters = useMemo(
    () =>
      semesters.filter(
        (semester) =>
          String(semester.department_id) === selection.department_id &&
          String(semester.programme_id) === selection.programme_id,
      ),
    [semesters, selection.department_id, selection.programme_id],
  )
  const filteredCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          String(course.department_id) === selection.department_id &&
          String(course.programme_id) === selection.programme_id &&
          String(course.semester_id) === selection.semester_id,
      ),
    [courses, selection.department_id, selection.programme_id, selection.semester_id],
  )

  useEffect(() => {
    async function loadMasters() {
      setIsLoading(true)
      setError('')

      try {
        const responses = await Promise.all([
          fetch('/api/departments'),
          fetch('/api/programmes'),
          fetch('/api/semesters'),
          fetch('/api/courses'),
        ])
        const data = await Promise.all(responses.map((response) => readResponseJson(response)))

        responses.forEach((response, index) => {
          if (!response.ok) {
            throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load master data.')
          }
        })

        setDepartments(data[0] || [])
        setProgrammes(data[1] || [])
        setSemesters(data[2] || [])
        setCourses(data[3] || [])
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadMasters()
  }, [])

  useEffect(() => {
    async function loadMarkData() {
      if (!selection.course_id) {
        setInternalRows([])
        setInternalHistoryRows([])
        setExternalRows([])
        return
      }

      setIsLoading(true)
      setError('')

      try {
        const query = `course_id=${selection.course_id}`
        const responses = await Promise.all([
          fetch(`/api/internal-marks-upload?${query}`),
          fetch(`/api/external-marks-upload?${query}&academic_year=${encodeURIComponent(selection.academic_year)}`),
        ])
        const data = await Promise.all(responses.map((response) => readResponseJson(response)))

        responses.forEach((response, index) => {
          if (!response.ok) {
            throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load mark attainment data.')
          }
        })

        setInternalHistoryRows(data[0] || [])
        setInternalRows((data[0] || []).filter((row) => String(row.academic_year || '') === selection.academic_year))
        setExternalRows((data[1] || []).filter((row) => String(row.academic_year || '') === selection.academic_year))
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadMarkData()
  }, [selection.academic_year, selection.course_id])

  function updateSelection(event) {
    const { name, value } = event.target

    setSelection((current) => {
      const next = { ...current, [name]: value }

      if (name === 'department_id') {
        next.programme_id = ''
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'programme_id') {
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'semester_id') {
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'course_id') {
        const course = courses.find((row) => String(row.course_id) === value)
        const semester = semesters.find((row) => String(row.semester_id) === String(course?.semester_id || next.semester_id))
        next.academic_year = String(semester?.academic_year || '')
      }

      return next
    })
    setMessage('')
    setError('')
  }

  const attainmentRowsFromUpload = useMemo(
    () =>
      markAttainmentTools.map((tool) => {
        const sourceRows = tool.key === 'end_sem' ? externalRows : internalRows
        const markKey = tool.key === 'end_sem' ? 'percent_mark' : tool.key
        const appearedRows = sourceRows.filter((row) => String(row.regd_no || '').trim())
        const total = appearedRows.reduce((sum, row) => sum + Number(row[markKey] || 0), 0)
        const calculatedTargetAverage = appearedRows.length ? total / appearedRows.length : 0
        const selectedYearStart = Number.parseInt(selection.academic_year, 10)
        const previousYears = [...new Set(internalHistoryRows
          .map((row) => String(row.academic_year || ''))
          .filter((year) => Number.parseInt(year, 10) < selectedYearStart))]
          .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10))
          .slice(0, 2)
        const previousYearAverages = previousYears.map((year) => {
          const rows = internalHistoryRows.filter(
            (row) => String(row.academic_year || '') === year && String(row.regd_no || '').trim(),
          )
          return rows.length
            ? rows.reduce((sum, row) => sum + Number(row[tool.key] || 0), 0) / rows.length
            : null
        }).filter((value) => Number.isFinite(value))
        const previousTwoYearAverage = previousYearAverages.length
          ? previousYearAverages.reduce((sum, value) => sum + value, 0) / previousYearAverages.length
          : calculatedTargetAverage
        const uploadedTargetAverage = appearedRows
          .map((row) => Number(row.target_average))
          .find((value) => Number.isFinite(value) && value > 0)
        const targetAverage =
          tool.key === 'end_sem'
            ? (Number.isFinite(uploadedTargetAverage) ? uploadedTargetAverage : calculatedTargetAverage)
            : previousTwoYearAverage
        const attainedCount = appearedRows.filter((row) => Number(row[markKey] || 0) >= targetAverage).length
        const attainmentPercent = appearedRows.length ? (attainedCount / appearedRows.length) * 100 : 0
        const { level, levelPoint } = getAssessmentLevel(attainmentPercent)

        return {
          assessment_tool: tool.key,
          tool_label: tool.label,
          weightage: tool.weightage,
          target_average: Number(targetAverage.toFixed(2)),
          attainment_percent: Number(attainmentPercent.toFixed(2)),
          level,
          level_point: levelPoint === '-' ? null : levelPoint,
        }
      }),
    [externalRows, internalHistoryRows, internalRows, selection.academic_year],
  )

  const rowByTool = useMemo(
    () =>
      attainmentRowsFromUpload.reduce((mapping, row) => {
        mapping[row.assessment_tool] = row
        return mapping
      }, {}),
    [attainmentRowsFromUpload],
  )

  async function saveAttainment() {
    setError('')
    setMessage('')

    if (!selection.department_id || !selection.programme_id || !selection.semester_id || !selection.course_id) {
      setError('Select Department, Programme, Semester, Course, and Academic Year before saving.')
      return
    }

    if (!selection.academic_year) {
      setError('Academic Year is not configured for the selected Course Semester.')
      return
    }

    if (!internalRows.length && !externalRows.length) {
      setError('No saved Internal Mark Upload or External Mark Upload data found for this course.')
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch('/api/mark-attainment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selection,
          department_id: Number(selection.department_id),
          programme_id: Number(selection.programme_id),
          semester_id: Number(selection.semester_id),
          course_id: Number(selection.course_id),
          rows: attainmentRowsFromUpload,
        }),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save Mark Attainment.')
      }

      setMessage(data?.message || 'Mark Attainment saved.')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  function displayValue(toolKey, field) {
    const row = rowByTool[toolKey]

    if (!row) {
      return ''
    }

    if (field === 'level') {
      return row.level || ''
    }

    if (field === 'level_point') {
      return row.level_point ?? ''
    }

    if (toolKey === 'end_sem') {
      return Math.round(Number(row[field] || 0))
    }

    return Number(row[field] || 0).toFixed(2)
  }

  return (
    <section className="department-page co-po-page mark-attainment-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Dashboard / Attainment / Mark Attainment</p>
          <h3>Assessment Target & Mark Attainment</h3>
        </div>
        <button
          type="button"
          className="save-button"
          onClick={saveAttainment}
          disabled={isSaving || isLoading}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="mapping-selector-grid">
        <label>
          <span>Department</span>
          <select name="department_id" value={selection.department_id} onChange={updateSelection}>
            <option value="">Select Department</option>
            {departments.map((department) => (
              <option key={department.department_id} value={department.department_id}>
                {department.department_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Programme</span>
          <select name="programme_id" value={selection.programme_id} onChange={updateSelection}>
            <option value="">Select Programme</option>
            {filteredProgrammes.map((programme) => (
              <option key={programme.programme_id} value={programme.programme_id}>
                {programme.programme_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Semester</span>
          <select name="semester_id" value={selection.semester_id} onChange={updateSelection}>
            <option value="">Select Semester</option>
            {filteredSemesters.map((semester) => (
              <option key={semester.semester_id} value={semester.semester_id}>
                {semester.semester_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Course</span>
          <select name="course_id" value={selection.course_id} onChange={updateSelection}>
            <option value="">Select Course</option>
            {filteredCourses.map((course) => (
              <option key={course.course_id} value={course.course_id}>
                {course.course_code} - {course.course_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selection.course_id && <div className={`notice ${selection.academic_year ? 'success' : 'error'}`}>
        {selection.academic_year
          ? `Academic Year: ${selection.academic_year} (automatically selected from Course)`
          : 'Academic Year is not configured for the selected Course Semester.'}
      </div>}

      {isLoading && <div className="notice success">Loading Mark Attainment data...</div>}
      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Mark Attainment Calculation</h4>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ASSESSMENT TOOLS</th>
                {markAttainmentTools.map((tool) => (
                  <th key={tool.key}>{tool.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>WEIGHTAGE</th>
                {markAttainmentTools.map((tool) => (
                  <td key={`weightage-${tool.key}`}>{selection.course_id ? tool.weightage : ''}</td>
                ))}
              </tr>
              <tr>
                <th>TARGET AVERAGE<br />(AVERAGE OF LAST TWO YEARS EXAM)</th>
                {markAttainmentTools.map((tool) => (
                  <td key={`target-${tool.key}`}>{selection.course_id ? displayValue(tool.key, 'target_average') : ''}</td>
                ))}
              </tr>
              <tr>
                <th>% ATTAINMENT</th>
                {markAttainmentTools.map((tool) => (
                  <td key={`attainment-${tool.key}`}>{selection.course_id ? displayValue(tool.key, 'attainment_percent') : ''}</td>
                ))}
              </tr>
              <tr>
                <th>LEVEL</th>
                {markAttainmentTools.map((tool) => (
                  <td key={`level-${tool.key}`}>{selection.course_id ? displayValue(tool.key, 'level') : ''}</td>
                ))}
              </tr>
              <tr>
                <th>LEVEL POINT</th>
                {markAttainmentTools.map((tool) => (
                  <td key={`level-point-${tool.key}`}>{selection.course_id ? displayValue(tool.key, 'level_point') : ''}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </section>
  )
}

function CoAttainmentCalculationPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [selection, setSelection] = useState({
    department_id: '',
    programme_id: '',
    semester_id: '',
    course_id: '',
    academic_year: '',
    batch: '2022-26',
    internal_weight: 80,
    external_weight: 20,
  })
  const [markRows, setMarkRows] = useState([])
  const [internalMarkRows, setInternalMarkRows] = useState([])
  const [externalMarkRows, setExternalMarkRows] = useState([])
  const [articulationRows, setArticulationRows] = useState([])
  const [rubricRows, setRubricRows] = useState([])
  const [calculatedRows, setCalculatedRows] = useState([])
  const [uploadedLevelRows, setUploadedLevelRows] = useState({})
  const [uploadedLevelPointRows, setUploadedLevelPointRows] = useState({})
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const filteredProgrammes = useMemo(
    () =>
      programmes.filter(
        (programme) => String(programme.department_id) === selection.department_id,
      ),
    [programmes, selection.department_id],
  )
  const filteredSemesters = useMemo(
    () =>
      semesters.filter(
        (semester) =>
          String(semester.department_id) === selection.department_id &&
          String(semester.programme_id) === selection.programme_id,
      ),
    [semesters, selection.department_id, selection.programme_id],
  )
  const filteredCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          String(course.department_id) === selection.department_id &&
          String(course.programme_id) === selection.programme_id &&
          String(course.semester_id) === selection.semester_id,
      ),
    [courses, selection.department_id, selection.programme_id, selection.semester_id],
  )
  const markRowByTool = useMemo(
    () =>
      markRows.reduce((mapping, row) => {
        mapping[row.assessment_tool] = row
        return mapping
      }, {}),
    [markRows],
  )
  const internalLevelByTool = useMemo(() =>
    coAttainmentColumns.reduce((mapping, column) => {
      const appearedRows = internalMarkRows.filter((row) => String(row.regd_no || '').trim())
      const average = appearedRows.length
        ? appearedRows.reduce((total, row) => total + Number(row[column.markKey] || 0), 0) / appearedRows.length
        : 0
      const attainedCount = appearedRows.filter((row) => Number(row[column.markKey] || 0) >= average).length
      const attainmentPercentage = appearedRows.length ? (attainedCount / appearedRows.length) * 100 : 0
      const assessmentLevel = appearedRows.length ? getAssessmentLevel(attainmentPercentage) : { level: '', levelPoint: '' }
      mapping[column.key] = assessmentLevel
      return mapping
    }, {}),
  [internalMarkRows])
  const displayLevelRows = useMemo(
    () =>
      coAttainmentColumns.reduce((mapping, column) => {
        mapping[column.key] = internalLevelByTool[column.key]?.level || uploadedLevelRows[column.key] || markRowByTool[column.markKey]?.level || ''
        return mapping
      }, {}),
    [internalLevelByTool, markRowByTool, uploadedLevelRows],
  )
  const displayLevelPointRows = useMemo(
    () =>
      coAttainmentColumns.reduce((mapping, column) => {
        mapping[column.key] = internalLevelByTool[column.key]?.levelPoint || uploadedLevelPointRows[column.key] || markRowByTool[column.markKey]?.level_point || ''
        return mapping
      }, {}),
    [internalLevelByTool, markRowByTool, uploadedLevelPointRows],
  )
  const externalAttainment = useMemo(() => {
    const savedSummary = externalMarkRows[0]?.calculation_summary
    if (savedSummary?.level && savedSummary?.level_point !== undefined) {
      return { level: savedSummary.level, levelPoint: savedSummary.level_point }
    }

    const attainmentPercent = Number(externalMarkRows[0]?.attainment_value)

    if (!Number.isFinite(attainmentPercent)) {
      return { level: '', levelPoint: '' }
    }

    const { level, levelPoint } = getAssessmentLevel(attainmentPercent)
    return {
      level: level === '-' ? '' : level,
      levelPoint: levelPoint === '-' ? '' : levelPoint,
    }
  }, [externalMarkRows])
  const articulationByCo = useMemo(
    () =>
      articulationRows.reduce((mapping, row) => {
        const coCode = normalizeCourseOutcomeCode(row.co_code)

        if (!coCode) {
          return mapping
        }

        mapping[coCode] ||= {}
        coAttainmentColumns.forEach((column) => {
          mapping[coCode][column.key] = Math.max(
            Number(mapping[coCode][column.key] || 0),
            Number(row[column.key] || 0),
          )
        })

        return mapping
      }, {}),
    [articulationRows],
  )
  const rubricByCo = useMemo(
    () =>
      rubricRows.reduce((mapping, row) => {
        const coCode = normalizeCourseOutcomeCode(row.co_code)

        if (coCode) {
          mapping[coCode] = normalizeArticulationCell(row.rubric)
        }

        return mapping
      }, {}),
    [rubricRows],
  )
  const visibleCoRows = calculatedRows.length
    ? calculatedRows
    : coCodeOptions.map((coCode) => ({
        co_code: coCode,
        values: coAttainmentColumns.reduce((values, column) => {
          values[column.key] = ''
          return values
        }, {}),
        results: coAttainmentResultColumns.reduce((values, column) => {
          values[column.key] = ''
          return values
        }, {}),
      }))

  useEffect(() => {
    async function loadMasters() {
      setIsLoading(true)
      setError('')

      try {
        const responses = await Promise.all([
          fetch('/api/departments'),
          fetch('/api/programmes'),
          fetch('/api/semesters'),
          fetch('/api/courses'),
        ])
        const data = await Promise.all(responses.map((response) => readResponseJson(response)))

        responses.forEach((response, index) => {
          if (!response.ok) {
            throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load master data.')
          }
        })

        setDepartments(data[0] || [])
        setProgrammes(data[1] || [])
        setSemesters(data[2] || [])
        setCourses(data[3] || [])
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadMasters()
  }, [])

  useEffect(() => {
    loadCalculationData({ silent: true })
  }, [selection.academic_year, selection.batch, selection.course_id])

  useEffect(() => {
    if ((internalMarkRows.length || markRows.length) && articulationRows.length) {
      calculateCoAttainment({ silent: true })
    }
  }, [articulationRows, externalMarkRows, internalMarkRows, markRows, rubricRows])

  function updateSelection(event) {
    const { name, value } = event.target

    setSelection((current) => {
      const next = { ...current, [name]: value }

      if (name === 'department_id') {
        next.programme_id = ''
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'programme_id') {
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'semester_id') {
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'course_id') {
        const course = courses.find((row) => String(row.course_id) === value)
        const semester = semesters.find((row) => String(row.semester_id) === String(course?.semester_id || next.semester_id))
        next.academic_year = String(semester?.academic_year || '')
      }

      return next
    })
    setCalculatedRows([])
    setUploadedLevelRows({})
    setUploadedLevelPointRows({})
    setMessage('')
    setError('')
  }

  async function loadCalculationData(options = {}) {
    if (!options.silent) {
      setError('')
      setMessage('')
    }

    if (!selection.course_id) {
      if (!options.silent) {
        setError('Select Department, Programme, Semester, Course, and Academic Year before loading data.')
      }
      return
    }

    setIsLoading(true)

    try {
      const query = `course_id=${selection.course_id}&academic_year=${encodeURIComponent(selection.academic_year)}`
      const savedQuery = `${query}&batch=${encodeURIComponent(selection.batch)}`
      const responses = await Promise.all([
        fetch(`/api/mark-attainment?${query}`),
        fetch(`/api/articulation-matrix?course_id=${selection.course_id}`),
        fetch(`/api/co-attainment-calculation?${savedQuery}`),
        fetch(`/api/university-question-rubric?course_id=${selection.course_id}`),
        fetch(`/api/external-marks-upload?${query}`),
        fetch(`/api/internal-marks-upload?course_id=${selection.course_id}`),
      ])
      const data = await Promise.all(responses.map((response) => readResponseJson(response)))

      responses.forEach((response, index) => {
        if (!response.ok) {
          throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load CO Attainment Calculation data.')
        }
      })

      setMarkRows(data[0] || [])
      setArticulationRows(data[1] || [])
      setCalculatedRows(data[2]?.row_data?.coRows || [])
      setUploadedLevelRows(data[2]?.row_data?.levelRows || {})
      setUploadedLevelPointRows(data[2]?.row_data?.levelPointRows || {})
      setRubricRows(data[3] || [])
      setExternalMarkRows(data[4] || [])
      setInternalMarkRows((data[5] || []).filter((row) => String(row.academic_year || '') === selection.academic_year))
      if (!options.silent) {
        setMessage('CO Attainment source data loaded.')
      }
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  function calculateCoAttainment(options = {}) {
    if (!options.silent) {
      setError('')
      setMessage('')
    }

    if ((!internalMarkRows.length && !markRows.length) || !articulationRows.length) {
      if (!options.silent) {
        setError('Internal Mark Upload or Mark Attainment data and Articulation Matrix data are required.')
      }
      return
    }

    const articulationCoCodes = [...new Set(
      articulationRows.map((row) => normalizeCourseOutcomeCode(row.co_code)).filter(Boolean),
    )]
    const nextRows = (articulationCoCodes.length ? articulationCoCodes : coCodeOptions).map((coCode) => {
      let articulationTotal = 0
      let weightedLevelPointTotal = 0
      const values = coAttainmentColumns.reduce((mapping, column) => {
        const articulationLevel = Number(articulationByCo[coCode]?.[column.key] || 0)
        const levelPoint = Number(displayLevelPointRows[column.key] || 0)
        mapping[column.key] = articulationLevel || ''

        if (articulationLevel) {
          articulationTotal += articulationLevel
          weightedLevelPointTotal += articulationLevel * levelPoint
        }

        return mapping
      }, {})
      const internalAttainment = articulationTotal ? weightedLevelPointTotal / articulationTotal : 0
      const endSem = Number(rubricByCo[coCode] || 0)
      const externalLevelPoint = Number(externalAttainment.levelPoint || 0)
      const externalAttainmentValue = endSem
        ? (externalLevelPoint * endSem) / endSem
        : 0
      const overall = internalAttainment || externalAttainmentValue
        ? (0.33 * internalAttainment) + (0.67 * externalAttainmentValue)
        : 0

      return {
        co_code: coCode,
        values,
        results: {
          internal_attainment: internalAttainment ? Number(internalAttainment.toFixed(2)) : '',
          end_sem: endSem || '',
          external_attainment: externalAttainmentValue
            ? Number(externalAttainmentValue.toFixed(2))
            : '',
          overall: overall ? Number(overall.toFixed(2)) : '',
        },
      }
    })

    setCalculatedRows(nextRows)
    setUploadedLevelRows({})
    setUploadedLevelPointRows({})
    if (!options.silent) {
      setMessage('CO Attainment Calculation completed.')
    }
  }

  function uploadCoAttainmentExcel(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setError('')
    setMessage('')

    try {
      const reader = new FileReader()

      reader.onload = (loadEvent) => {
        try {
          const workbook = XLSX.read(loadEvent.target.result, { type: 'array' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
          const headerRow = rows.find((row) =>
            String(row[0] || '').trim().toUpperCase().replace(/\s+/g, '') === 'COURSEOUTCOME',
          )

          if (!headerRow) {
            throw new Error('Invalid Excel format. First column header must be COURSE OUTCOME.')
          }

          const columnIndexes = coAttainmentColumns.map((column) => {
            const index = headerRow.findIndex(
              (cell) => normalizeHeader(cell) === normalizeHeader(column.label),
            )
            return index >= 0 ? index : null
          })
          const resultColumnIndexes = coAttainmentResultColumns.map((column) => {
            const index = headerRow.findIndex(
              (cell) => normalizeHeader(cell) === normalizeHeader(column.label),
            )
            return index >= 0 ? index : null
          })
          const levelRows = {}
          const levelPointRows = {}
          const coRows = []

          rows.forEach((row) => {
            const rowLabel = String(row[0] || '').trim().toUpperCase().replace(/\s+/g, '')

            if (rowLabel === 'LEVEL') {
              coAttainmentColumns.forEach((column, index) => {
                levelRows[column.key] = String(row[columnIndexes[index]] || '').trim()
              })
              return
            }

            if (rowLabel === 'LEVELPOINT') {
              coAttainmentColumns.forEach((column, index) => {
                const value = row[columnIndexes[index]]
                levelPointRows[column.key] = value === '' ? '' : Number(value) || value
              })
              return
            }

            if (/^CO\d+$/i.test(rowLabel)) {
              const values = coAttainmentColumns.reduce((mapping, column, index) => {
                const value = row[columnIndexes[index]]
                mapping[column.key] = value === '' ? '' : Number(value) || value
                return mapping
              }, {})
              const results = coAttainmentResultColumns.reduce((mapping, column, index) => {
                const value = row[resultColumnIndexes[index]]
                mapping[column.key] = value === '' || value === undefined ? '' : Number(value) || value
                return mapping
              }, {})

              coRows.push({
                co_code: rowLabel.toUpperCase(),
                values,
                results,
              })
            }
          })

          if (!coRows.length) {
            throw new Error('No CO rows found. Expected rows like CO1, CO2, CO3.')
          }

          setUploadedLevelRows(levelRows)
          setUploadedLevelPointRows(levelPointRows)
          setCalculatedRows(coRows)
          setMessage(`${coRows.length} CO Attainment rows uploaded and displayed.`)
        } catch (parseError) {
          setError(parseError.message)
        }
      }

      reader.readAsArrayBuffer(file)
    } catch (uploadError) {
      setError(uploadError.message)
    }
  }

  async function saveCoAttainmentCalculation() {
    setError('')
    setMessage('')

    if (!selection.department_id || !selection.programme_id || !selection.semester_id || !selection.course_id) {
      setError('Select Department, Programme, Semester, Course, Academic Year, and Batch before saving.')
      return
    }

    if (!calculatedRows.length) {
      setError('Upload Excel or select a course with saved Mark Attainment, Articulation Matrix, and Rubric Mapping data before saving.')
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch('/api/co-attainment-calculation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selection,
          department_id: Number(selection.department_id),
          programme_id: Number(selection.programme_id),
          semester_id: Number(selection.semester_id),
          course_id: Number(selection.course_id),
          internal_weight: Number(selection.internal_weight),
          external_weight: Number(selection.external_weight),
          row_data: {
            levelRows: coAttainmentColumns.reduce((mapping, column) => {
              mapping[column.key] = displayLevelRows[column.key] || ''
              return mapping
            }, {}),
            levelPointRows: coAttainmentColumns.reduce((mapping, column) => {
              mapping[column.key] = displayLevelPointRows[column.key] ?? ''
              return mapping
            }, {}),
            coRows: calculatedRows,
          },
        }),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save CO Attainment Calculation.')
      }

      setMessage(data?.message || 'CO Attainment Calculation saved.')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  function exportCoAttainmentFormat() {
    const rows = [
      [
        'COURSE OUTCOME',
        ...coAttainmentColumns.map((column) => column.label),
        ...coAttainmentResultColumns.map((column) => column.label),
      ],
      [
        'LEVEL',
        ...coAttainmentColumns.map((column) => displayLevelRows[column.key] || ''),
        '',
        'HL',
        '',
        '',
      ],
      [
        'LEVEL POINT',
        ...coAttainmentColumns.map((column) => displayLevelPointRows[column.key] ?? ''),
        '',
        3,
        '',
        '',
      ],
      ...visibleCoRows.map((row) => [
        row.co_code,
        ...coAttainmentColumns.map((column) => row.values[column.key] ?? ''),
        ...coAttainmentResultColumns.map((column) => row.results?.[column.key] ?? ''),
      ]),
    ]
    const worksheet = XLSX.utils.aoa_to_sheet(rows)
    worksheet['!cols'] = [
      { wch: 18 },
      ...coAttainmentColumns.map(() => ({ wch: 12 })),
      ...coAttainmentResultColumns.map(() => ({ wch: 18 })),
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'CO Attainment')
    XLSX.writeFile(workbook, 'co-attainment-calculation.xlsx')
  }

  return (
    <section className="department-page co-po-page co-attainment-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Dashboard / OBE Calculation / CO Attainment</p>
          <h3>CO Attainment Calculation</h3>
        </div>
        <button
          type="button"
          className="save-button"
          onClick={saveCoAttainmentCalculation}
          disabled={isSaving || isLoading}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="mapping-selector-grid">
        <label>
          <span>Department</span>
          <select name="department_id" value={selection.department_id} onChange={updateSelection}>
            <option value="">Select Department</option>
            {departments.map((department) => (
              <option key={department.department_id} value={department.department_id}>
                {department.department_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Programme</span>
          <select name="programme_id" value={selection.programme_id} onChange={updateSelection}>
            <option value="">Select Programme</option>
            {filteredProgrammes.map((programme) => (
              <option key={programme.programme_id} value={programme.programme_id}>
                {programme.programme_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Semester</span>
          <select name="semester_id" value={selection.semester_id} onChange={updateSelection}>
            <option value="">Select Semester</option>
            {filteredSemesters.map((semester) => (
              <option key={semester.semester_id} value={semester.semester_id}>
                {semester.semester_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Course</span>
          <select name="course_id" value={selection.course_id} onChange={updateSelection}>
            <option value="">Select Course</option>
            {filteredCourses.map((course) => (
              <option key={course.course_id} value={course.course_id}>
                {course.course_code} - {course.course_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selection.course_id && <div className={`notice ${selection.academic_year ? 'success' : 'error'}`}>
        {selection.academic_year
          ? `Academic Year: ${selection.academic_year} (automatically selected from Course)`
          : 'Academic Year is not configured for the selected Course Semester.'}
      </div>}

      {isLoading && <div className="notice success">Loading CO Attainment data...</div>}
      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>CO Attainment Calculation</h4>
          <span>{calculatedRows.length} records</span>
        </div>
        <div className="table-wrap">
          <table className="co-attainment-assessment-table">
            <thead>
              <tr>
                <th>COURSE OUTCOME</th>
                {coAttainmentColumns.map((column) => <th key={column.key}>{column.label}</th>)}
                <th>ATTAINMENT LEVEL<br />(INTERNAL)</th>
                <th>END SEM</th>
                <th>ATTAINMENT LEVEL<br />(EXTERNAL)</th>
                <th>OVERALL</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>LEVEL</th>
                {coAttainmentColumns.map((column) => <td key={`level-${column.key}`}>{displayLevelRows[column.key] || ''}</td>)}
                <td></td>
                <td>{externalAttainment.level}</td>
                <td></td>
                <td></td>
              </tr>
              <tr>
                <th>LEVEL POINT</th>
                {coAttainmentColumns.map((column) => <td key={`level-point-${column.key}`}>{displayLevelPointRows[column.key] ?? ''}</td>)}
                <td></td>
                <td>{externalAttainment.levelPoint}</td>
                <td></td>
                <td></td>
              </tr>
              {calculatedRows.map((row) => <tr key={row.co_code}>
                <th>{row.co_code}</th>
                {coAttainmentColumns.map((column) => <td key={`${row.co_code}-${column.key}`}>{row.values?.[column.key] ?? ''}</td>)}
                <td>{row.results?.internal_attainment === '' || row.results?.internal_attainment === undefined ? '' : Number(row.results.internal_attainment).toFixed(2)}</td>
                <td>{row.results?.end_sem ?? ''}</td>
                <td>{row.results?.external_attainment === '' || row.results?.external_attainment === undefined ? '' : Number(row.results.external_attainment).toFixed(2)}</td>
                <td>{row.results?.overall === '' || row.results?.overall === undefined ? '' : Number(row.results.overall).toFixed(2)}</td>
              </tr>)}
              {!calculatedRows.length && <tr><td colSpan={coAttainmentColumns.length + 5} className="empty-cell">Select a Course to load CO Attainment data.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

    </section>
  )
}

function InternalMarkUploadPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [selection, setSelection] = useState({
    department_id: '',
    programme_id: '',
    semester_id: '',
    course_id: '',
    academic_year: '',
    branch: '',
  })
  const [markRows, setMarkRows] = useState([])
  const [savedRows, setSavedRows] = useState([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const filteredProgrammes = useMemo(
    () => programmes.filter((programme) => String(programme.department_id) === selection.department_id),
    [programmes, selection.department_id],
  )
  const filteredSemesters = useMemo(
    () =>
      semesters.filter(
        (semester) =>
          String(semester.department_id) === selection.department_id &&
          String(semester.programme_id) === selection.programme_id,
      ),
    [semesters, selection.department_id, selection.programme_id],
  )
  const filteredCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          String(course.department_id) === selection.department_id &&
          String(course.programme_id) === selection.programme_id &&
          String(course.semester_id) === selection.semester_id,
      ),
    [courses, selection.department_id, selection.programme_id, selection.semester_id],
  )
  const visibleRows = markRows.length ? markRows : savedRows
  const internalSummaryColumns = [
    { key: 'attd', label: 'ATTD.' },
    { key: 'a1', label: 'A1' },
    { key: 'a2', label: 'A2' },
    { key: 'qt1', label: 'QT1' },
    { key: 'qt2', label: 'QT2' },
    { key: 'st1', label: 'ST1' },
    { key: 'st2', label: 'ST2' },
    { key: 'ct1', label: 'CT1' },
    { key: 'ct2', label: 'CT2' },
    { key: 'internal_mark', label: 'INTERNAL MARK' },
  ]
  const internalSummary = useMemo(() => {
    const appearedCount = visibleRows.filter((row) => String(row.regd_no || '').trim()).length
    const levelPointMap = { LL: 1, ML: 2, HL: 3 }

    return internalSummaryColumns.map((column) => {
      const total = visibleRows.reduce((sum, row) => sum + Number(row[column.key] || 0), 0)
      const average = appearedCount ? total / appearedCount : 0
      const targetAverage = average
      const attainedCount = visibleRows.filter(
        (row) => String(row.regd_no || '').trim() && Number(row[column.key] || 0) >= targetAverage,
      ).length
      const attainmentPercent = appearedCount ? (attainedCount / appearedCount) * 100 : 0
      const matchedLevel = defaultAssessmentLevels.find((level) => {
        const minPercentage = Number(level.min_percentage)
        const maxPercentage = Number(level.max_percentage)
        return attainmentPercent >= minPercentage && attainmentPercent <= maxPercentage
      })
      const level = matchedLevel?.code || '-'

      return {
        ...column,
        appearedCount,
        attainedCount,
        attainmentPercent,
        average,
        targetAverage,
        level,
        levelPoint: levelPointMap[level] || '-',
      }
    })
  }, [internalSummaryColumns, visibleRows])

  useEffect(() => {
    async function loadMasters() {
      setIsLoading(true)
      setError('')

      try {
        const responses = await Promise.all([
          fetch('/api/departments'),
          fetch('/api/programmes'),
          fetch('/api/semesters'),
          fetch('/api/courses'),
        ])
        const data = await Promise.all(responses.map((response) => readResponseJson(response)))

        responses.forEach((response, index) => {
          if (!response.ok) {
            throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load master data.')
          }
        })

        setDepartments(data[0] || [])
        setProgrammes(data[1] || [])
        setSemesters(data[2] || [])
        setCourses(data[3] || [])
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadMasters()
  }, [])

  useEffect(() => {
    async function loadSavedRows() {
      if (!selection.course_id || !selection.academic_year) {
        setSavedRows([])
        setCalculationSummary(null)
        setPreviousAverageInputs({ minus_two: '', minus_one: '' })
        return
      }

      try {
        const response = await fetch(`/api/internal-marks-upload?course_id=${selection.course_id}`)
        const data = await readResponseJson(response)

        if (!response.ok) {
          throw new Error(data?.detail || data?.error || 'Unable to load internal marks.')
        }

        setSavedRows(
          (data || []).filter(
            (row) =>
              String(row.academic_year || '') === selection.academic_year &&
              String(row.branch || '') === selection.branch,
          ),
        )
      } catch (loadError) {
        setError(loadError.message)
      }
    }

    loadSavedRows()
  }, [selection.academic_year, selection.branch, selection.course_id])

  function updateSelection(event) {
    const { name, value } = event.target

    setSelection((current) => {
      const next = { ...current, [name]: value }

      if (name === 'department_id') {
        const selectedDepartment = departments.find((department) => String(department.department_id) === value)
        next.programme_id = ''
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
        next.branch = selectedDepartment?.department_code || ''
      }

      if (name === 'programme_id') {
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'semester_id') {
        const selectedSemester = semesters.find((semester) => String(semester.semester_id) === value)
        next.course_id = ''
        next.academic_year = String(selectedSemester?.academic_year || '')
      }

      return next
    })
    setMarkRows([])
    setMessage('')
    setError('')
  }

  function downloadInternalMarksFormat() {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['S.N', 'REGD. NO', 'NAME', 'ATTD.', 'A1', 'A2', 'QT1', 'QT2', 'ST1', 'ST2', 'CT1', 'CT2'],
      [1, '2401206172', 'AMRITANANDA MOHANTY', 5, 1.5, 1.5, 2.5, 2.5, 2.5, 2.5, 9, 7],
    ])
    worksheet['!ref'] = 'A1:L2'
    worksheet['!cols'] = [
      { wch: 7 },
      { wch: 16 },
      { wch: 30 },
      ...Array.from({ length: 9 }, () => ({ wch: 9 })),
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Internal Marks')
    XLSX.writeFile(workbook, 'internal-mark-upload-format.xlsx')
  }

  function parseInternalMarks(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setMessage('')
    setError('')

    try {
      const reader = new FileReader()

      reader.onload = (loadEvent) => {
        try {
          const workbook = XLSX.read(loadEvent.target.result, { type: 'array' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
          const parsedRows = rows
            .map((row, index) => {
              const regdNo = String(getSheetValue(row, ['regdno', 'registrationno', 'regno'])).trim()
              const studentName = String(getSheetValue(row, ['studentname', 'name'])).trim()
              const attd = Number(getSheetValue(row, ['attd', 'attendance'])) || 0
              const a1 = Number(getSheetValue(row, ['a1'])) || 0
              const a2 = Number(getSheetValue(row, ['a2'])) || 0
              const qt1 = Number(getSheetValue(row, ['qt1', 'q1'])) || 0
              const qt2 = Number(getSheetValue(row, ['qt2', 'q2'])) || 0
              const st1 = Number(getSheetValue(row, ['st1'])) || 0
              const st2 = Number(getSheetValue(row, ['st2'])) || 0
              const ct1 = Number(getSheetValue(row, ['ct1'])) || 0
              const ct2 = Number(getSheetValue(row, ['ct2'])) || 0
              const internalMark = attd + a1 + a2 + qt1 + qt2 + st1 + st2 + ct1 + ct2

              if (!regdNo || !studentName || !Number.isFinite(internalMark)) {
                return null
              }

              return {
                sl_no: Number(getSheetValue(row, ['sn', 'slno', 'serialno'])) || index + 1,
                regd_no: regdNo,
                student_name: studentName,
                attd,
                a1,
                a2,
                qt1,
                qt2,
                st1,
                st2,
                ct1,
                ct2,
                internal_mark: internalMark,
              }
            })
            .filter(Boolean)

          if (!parsedRows.length) {
            throw new Error('No valid rows found. Required columns: REGD. NO, STUDENT NAME, ATTD., A1, A2, QT1, QT2, ST1, ST2, CT1, CT2.')
          }

          setMarkRows(parsedRows)
          setMessage(`${parsedRows.length} internal mark rows loaded and calculated. Click Save Marks to store.`)
        } catch (parseError) {
          setError(parseError.message)
        }
      }

      reader.readAsArrayBuffer(file)
    } catch (parseError) {
      setError(parseError.message)
    }
  }

  async function saveInternalMarks() {
    setError('')
    setMessage('')

    if (!selection.department_id || !selection.programme_id || !selection.semester_id || !selection.course_id) {
      setError('Select Department, Programme, Semester, and Course before saving.')
      return
    }

    if (!selection.academic_year) {
      setError('Academic Year is not configured for the selected Semester.')
      return
    }

    if (!markRows.length) {
      setError('Upload internal marks Excel before saving.')
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch('/api/internal-marks-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selection,
          department_id: Number(selection.department_id),
          programme_id: Number(selection.programme_id),
          semester_id: Number(selection.semester_id),
          course_id: Number(selection.course_id),
          rows: markRows,
        }),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save internal marks.')
      }

      setSavedRows(markRows)
      setMarkRows([])
      setMessage(data?.message || 'Internal marks saved.')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="department-page co-po-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Dashboard / Assessment / Internal Mark Upload</p>
          <h3>Internal Mark Upload</h3>
        </div>
      </div>

      <div className="mapping-selector-grid">
        <label>
          <span>Department</span>
          <select name="department_id" value={selection.department_id} onChange={updateSelection}>
            <option value="">Select Department</option>
            {departments.map((department) => (
              <option key={department.department_id} value={department.department_id}>
                {department.department_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Programme</span>
          <select name="programme_id" value={selection.programme_id} onChange={updateSelection}>
            <option value="">Select Programme</option>
            {filteredProgrammes.map((programme) => (
              <option key={programme.programme_id} value={programme.programme_id}>
                {programme.programme_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Semester</span>
          <select name="semester_id" value={selection.semester_id} onChange={updateSelection}>
            <option value="">Select Semester</option>
            {filteredSemesters.map((semester) => (
              <option key={semester.semester_id} value={semester.semester_id}>
                {semester.semester_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Course</span>
          <select name="course_id" value={selection.course_id} onChange={updateSelection}>
            <option value="">Select Course</option>
            {filteredCourses.map((course) => (
              <option key={course.course_id} value={course.course_id}>
                {course.course_code} - {course.course_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selection.semester_id && (
        <div className={`notice ${selection.academic_year ? 'success' : 'error'}`}>
          {selection.academic_year
            ? `Academic Year: ${selection.academic_year} (automatically selected from Semester)`
            : 'Academic Year is not configured for the selected Semester.'}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Excel Upload</h4>
          <span>Allowed Format: .xlsx / .xls</span>
        </div>
        <div className="mapping-actions">
          <button type="button" className="reset-button" onClick={downloadInternalMarksFormat}>
            Download Template
          </button>
          <label className="file-action">
            Upload Excel
            <input type="file" accept=".xlsx,.xls" onChange={parseInternalMarks} />
          </label>
          <button type="button" className="save-button" onClick={saveInternalMarks} disabled={isSaving}>
            Save Marks
          </button>
          <span className="form-status">Excel values: ATTD. out of 5, A1/A2/QT/ST out of 2.5, and CT1/CT2 out of 15. TOTAL is calculated after upload.</span>
        </div>
      </div>

      {isLoading && <div className="notice success">Loading master data...</div>}
      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>Internal Marks Preview</h4>
          <span>{visibleRows.length} records</span>
        </div>
        <div className="table-wrap">
          <table className="internal-marks-preview-table">
            <thead>
              <tr>
                <th>S.N</th>
                <th>REGD. NO.</th>
                <th>NAME</th>
                <th>ATTD.</th>
                <th>A1</th>
                <th>A2</th>
                <th>QT1</th>
                <th>QT2</th>
                <th>ST1</th>
                <th>ST2</th>
                <th>CT1</th>
                <th>CT2</th>
                <th>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={`${row.regd_no}-${index}`}>
                  <td>{row.sl_no || index + 1}</td>
                  <td>{row.regd_no}</td>
                  <td>{row.student_name}</td>
                  <td>{Number(row.attd || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td>{Number(row.a1 || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td>{Number(row.a2 || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td>{Number(row.qt1 || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td>{Number(row.qt2 || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td>{Number(row.st1 || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td>{Number(row.st2 || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td>{Number(row.ct1 || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td>{Number(row.ct2 || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td>{Math.round(Number(row.internal_mark || 0))}</td>
                </tr>
              ))}
              {!!visibleRows.length && (
                <>
                  <tr className="summary-row">
                    <td colSpan="3">AVERAGE MARK {selection.academic_year}</td>
                    {internalSummary.map((summary) => (
                      <td key={`average-${summary.key}`}>{summary.average.toFixed(2)}</td>
                    ))}
                  </tr>
                  <tr className="summary-row">
                    <td colSpan="3">TARGET AVERAGE</td>
                    {internalSummary.map((summary) => (
                      <td key={`target-${summary.key}`}>{summary.targetAverage.toFixed(2)}</td>
                    ))}
                  </tr>
                  <tr className="summary-row">
                    <td colSpan="3">NO. OF STUDENTS ATTAINED THE TARGET</td>
                    {internalSummary.map((summary) => (
                      <td key={`attained-${summary.key}`}>{summary.attainedCount}</td>
                    ))}
                  </tr>
                  <tr className="summary-row">
                    <td colSpan="3">TOTAL STUDENT APPEARED THE EXAM</td>
                    {internalSummary.map((summary) => (
                      <td key={`appeared-${summary.key}`}>{summary.appearedCount}</td>
                    ))}
                  </tr>
                  <tr className="summary-row">
                    <td colSpan="3">ATTAINMENT %</td>
                    {internalSummary.map((summary) => (
                      <td key={`percent-${summary.key}`}>{summary.attainmentPercent.toFixed(2)}</td>
                    ))}
                  </tr>
                  <tr className="summary-row">
                    <td colSpan="3">LEVEL</td>
                    {internalSummary.map((summary) => (
                      <td key={`level-${summary.key}`}>{summary.level}</td>
                    ))}
                  </tr>
                  <tr className="summary-row">
                    <td colSpan="3">LEVEL POINT</td>
                    {internalSummary.map((summary) => (
                      <td key={`point-${summary.key}`}>{summary.levelPoint}</td>
                    ))}
                  </tr>
                </>
              )}
              {!visibleRows.length && (
                <tr>
                  <td colSpan="13" className="empty-cell">
                    Upload internal marks Excel to preview rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function ExternalMarkUploadPage() {
  const [departments, setDepartments] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [courses, setCourses] = useState([])
  const [selection, setSelection] = useState({
    department_id: '',
    programme_id: '',
    semester_id: '',
    course_id: '',
    academic_year: '2024-25',
  })
  const [markRows, setMarkRows] = useState([])
  const [savedRows, setSavedRows] = useState([])
  const [calculationSummary, setCalculationSummary] = useState(null)
  const [previousAverageInputs, setPreviousAverageInputs] = useState({ minus_two: '', minus_one: '' })
  const [studentRoster, setStudentRoster] = useState([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const filteredProgrammes = useMemo(
    () =>
      programmes.filter(
        (programme) => String(programme.department_id) === selection.department_id,
      ),
    [programmes, selection.department_id],
  )

  const filteredSemesters = useMemo(
    () =>
      semesters.filter(
        (semester) =>
          String(semester.department_id) === selection.department_id &&
          String(semester.programme_id) === selection.programme_id,
      ),
    [semesters, selection.department_id, selection.programme_id],
  )

  const filteredCourses = useMemo(
    () =>
      courses.filter(
        (course) =>
          String(course.department_id) === selection.department_id &&
          String(course.programme_id) === selection.programme_id &&
          String(course.semester_id) === selection.semester_id,
      ),
    [courses, selection.department_id, selection.programme_id, selection.semester_id],
  )

  const selectedCourse = useMemo(
    () => courses.find((course) => String(course.course_id) === selection.course_id),
    [courses, selection.course_id],
  )

  function academicYearWithOffset(offset) {
    const startYear = Number(String(selection.academic_year || '').slice(0, 4))
    if (!Number.isInteger(startYear)) return ''
    const offsetStartYear = startYear + offset
    return `${offsetStartYear}-${String(offsetStartYear + 1).slice(-2)}`
  }

  const minusTwoAcademicYear = academicYearWithOffset(-2)
  const minusOneAcademicYear = academicYearWithOffset(-1)
  const hasPreviousAverageInputs = previousAverageInputs.minus_two !== '' &&
    previousAverageInputs.minus_one !== '' &&
    Number.isFinite(Number(previousAverageInputs.minus_two)) &&
    Number.isFinite(Number(previousAverageInputs.minus_one))

  const visibleMarkRows = markRows.length ? markRows : savedRows
  const calculationRows = useMemo(
    () => visibleMarkRows.filter((row) => row.percent_mark !== null && row.percent_mark !== '' && Number.isFinite(Number(row.percent_mark))),
    [visibleMarkRows],
  )
  const calculatedAverageMark = useMemo(() => {
    if (!calculationRows.length) {
      return 0
    }

    return calculationRows.reduce((total, row) => total + Number(row.percent_mark || 0), 0) / calculationRows.length
  }, [calculationRows])

  const averageMark = Number.isFinite(Number(calculationSummary?.current_average))
    ? Number(calculationSummary.current_average)
    : calculatedAverageMark
  const targetAverage = hasPreviousAverageInputs
    ? (Number(previousAverageInputs.minus_two) + Number(previousAverageInputs.minus_one)) / 2
    : Number.isFinite(Number(calculationSummary?.target_average))
    ? Number(calculationSummary.target_average)
    : averageMark
  const regdNoCount = useMemo(
    () => calculationRows.filter((row) =>
      String(row.regd_no || '').trim(),
    ).length,
    [calculationRows],
  )
  const calculatedStudentsAboveTarget = useMemo(
    () => calculationRows.filter((row) =>
      String(row.regd_no || '').trim() && Number(row.percent_mark || 0) >= targetAverage,
    ).length,
    [calculationRows, targetAverage],
  )
  const studentsAboveTarget = hasPreviousAverageInputs
    ? calculatedStudentsAboveTarget
    : Number.isFinite(Number(calculationSummary?.students_attained))
    ? Number(calculationSummary.students_attained)
    : calculatedStudentsAboveTarget
  const totalStudentsAppeared = hasPreviousAverageInputs
    ? regdNoCount
    : Number.isFinite(Number(calculationSummary?.total_students))
    ? Number(calculationSummary.total_students)
    : regdNoCount
  const calculatedAttainmentValue = useMemo(() => {
    if (!regdNoCount) {
      return 0
    }

    return (calculatedStudentsAboveTarget / regdNoCount) * 100
  }, [regdNoCount, calculatedStudentsAboveTarget])
  const attainmentValue = hasPreviousAverageInputs
    ? calculatedAttainmentValue
    : Number.isFinite(Number(calculationSummary?.attainment_percentage))
    ? Number(calculationSummary.attainment_percentage)
    : calculatedAttainmentValue
  const calculatedAttainmentLevel = useMemo(() => {
    if (!totalStudentsAppeared) {
      return '-'
    }

    const matchedLevel = defaultAssessmentLevels.find((level) => {
      const minPercentage = Number(level.min_percentage)
      const maxPercentage = Number(level.max_percentage)
      return attainmentValue >= minPercentage && attainmentValue <= maxPercentage
    })

    return matchedLevel?.code || '-'
  }, [attainmentValue, totalStudentsAppeared])
  const attainmentLevel = hasPreviousAverageInputs ? calculatedAttainmentLevel : calculationSummary?.level || calculatedAttainmentLevel
  const attainmentLevelPoint = !hasPreviousAverageInputs && Number.isFinite(Number(calculationSummary?.level_point))
    ? Number(calculationSummary.level_point)
    : attainmentLevelPointMap[attainmentLevel] || '-'
  const currentCalculationSummary = {
    year_averages: [
      { academic_year: selection.academic_year, average: averageMark },
      ...(hasPreviousAverageInputs ? [
        { academic_year: minusOneAcademicYear, average: Number(previousAverageInputs.minus_one) },
        { academic_year: minusTwoAcademicYear, average: Number(previousAverageInputs.minus_two) },
      ] : calculationSummary?.year_averages?.slice(1) || []),
    ].filter((row) => row.academic_year && Number.isFinite(Number(row.average))),
    current_average: averageMark,
    target_average: targetAverage,
    students_attained: studentsAboveTarget,
    total_students: totalStudentsAppeared,
    attainment_percentage: attainmentValue,
    level: attainmentLevel,
    level_point: attainmentLevelPoint,
  }

  useEffect(() => {
    async function loadMasters() {
      setIsLoading(true)
      setError('')

      try {
        const responses = await Promise.all([
          fetch('/api/departments'),
          fetch('/api/programmes'),
          fetch('/api/semesters'),
          fetch('/api/courses'),
        ])
        const data = await Promise.all(responses.map((response) => readResponseJson(response)))

        responses.forEach((response, index) => {
          if (!response.ok) {
            throw new Error(data[index]?.detail || data[index]?.error || 'Unable to load master data.')
          }
        })

        setDepartments(data[0] || [])
        setProgrammes(data[1] || [])
        setSemesters(data[2] || [])
        setCourses(data[3] || [])
      } catch (loadError) {
        setError(loadError.message)
      } finally {
        setIsLoading(false)
      }
    }

    loadMasters()
  }, [])

  useEffect(() => {
    async function loadStudentRoster() {
      if (!selection.department_id || !selection.programme_id || !selection.course_id) {
        setStudentRoster([])
        return
      }

      try {
        const query = new URLSearchParams({
          department_id: selection.department_id,
          programme_id: selection.programme_id,
        })
        const response = await fetch(`/api/students?${query}`)
        const data = await readResponseJson(response)
        if (!response.ok) {
          throw new Error(data?.detail || data?.error || 'Unable to load student roster.')
        }
        setStudentRoster((data || []).filter((student) => student.status !== 'Inactive'))
      } catch (loadError) {
        setStudentRoster([])
        setError(loadError.message)
      }
    }

    loadStudentRoster()
  }, [selection.course_id, selection.department_id, selection.programme_id])

  useEffect(() => {
    async function loadSavedRows() {
      if (!selection.course_id || !selection.academic_year) {
        setSavedRows([])
        return
      }

      try {
        const response = await fetch(
          `/api/external-marks-upload?course_id=${selection.course_id}&academic_year=${encodeURIComponent(selection.academic_year)}`,
        )
        const data = await readResponseJson(response)

        if (!response.ok) {
          throw new Error(data?.detail || data?.error || 'Unable to load external marks.')
        }

        const savedSummary = data?.[0]?.calculation_summary || null
        setSavedRows(data || [])
        setCalculationSummary(savedSummary)
        setPreviousAverageInputs({
          minus_two: savedSummary?.year_averages?.find((row) => row.academic_year === minusTwoAcademicYear)?.average ?? '',
          minus_one: savedSummary?.year_averages?.find((row) => row.academic_year === minusOneAcademicYear)?.average ?? '',
        })
      } catch (loadError) {
        setError(loadError.message)
      }
    }

    loadSavedRows()
  }, [minusOneAcademicYear, minusTwoAcademicYear, selection.academic_year, selection.course_id])

  function updateSelection(event) {
    const { name, value } = event.target

    setSelection((current) => {
      const next = { ...current, [name]: value }

      if (name === 'department_id') {
        next.programme_id = ''
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'programme_id') {
        next.semester_id = ''
        next.course_id = ''
        next.academic_year = ''
      }

      if (name === 'semester_id') {
        const selectedSemester = semesters.find((semester) => String(semester.semester_id) === value)
        next.course_id = ''
        next.academic_year = String(selectedSemester?.academic_year || '')
      }

      return next
    })
    setMarkRows([])
    setCalculationSummary(null)
    setPreviousAverageInputs({ minus_two: '', minus_one: '' })
    setMessage('')
    setError('')
  }

  function parseExternalMarks(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setError('')
    setMessage('')

    try {
      const reader = new FileReader()

      reader.onload = (loadEvent) => {
        try {
          const workbook = XLSX.read(loadEvent.target.result, { type: 'array' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
          const columnCount = Math.max(0, ...sheetRows.slice(0, 2).map((row) => row.length))
          const combinedHeaders = Array.from({ length: columnCount }, (_item, index) =>
            normalizeHeader(`${sheetRows[0]?.[index] || ''} ${sheetRows[1]?.[index] || ''}`),
          )
          const findColumn = (...names) => combinedHeaders.findIndex((header) =>
            names.some((name) => header.includes(normalizeHeader(name))),
          )
          const slNoColumn = findColumn('slno', 'sn', 'serialno')
          const regdNoColumn = findColumn('regdno', 'registrationno', 'regno', 'rollno')
          const studentNameColumn = findColumn('studentname', 'name')
          const sgpaColumn = findColumn('sgpa')
          const gradeColumn = findColumn('grade')
          const baseMarkColumn = combinedHeaders.findIndex((header) =>
            header.includes('basemark') || header.includes('percentmark'),
          )
          const hasSecondHeaderRow = combinedHeaders.some((header) => header.includes('basemark'))
          const firstDataRowIndex = hasSecondHeaderRow ? 2 : 1
          const summaryStartIndex = sheetRows.findIndex((row, index) =>
            index >= firstDataRowIndex && /^AVERAGE\s*-/i.test(String(row[slNoColumn >= 0 ? slNoColumn : 0] || '').trim()),
          )
          const studentRows = sheetRows.slice(
            firstDataRowIndex,
            summaryStartIndex >= 0 ? summaryStartIndex : sheetRows.length,
          )
          const summaryEntries = (summaryStartIndex >= 0 ? sheetRows.slice(summaryStartIndex) : [])
            .map((row) => {
              const label = String(row[slNoColumn >= 0 ? slNoColumn : 0] || '').trim()
              const value = [...row].reverse().find((item) => String(item ?? '').trim() !== '' && item !== label)
              return { label, value }
            })
            .filter((entry) => entry.label)
          const summaryValue = (pattern) => summaryEntries.find((entry) => pattern.test(entry.label))?.value
          const yearAverages = summaryEntries
            .filter((entry) => /^AVERAGE\s*-\s*\d{4}-\d{2}$/i.test(entry.label))
            .map((entry) => ({
              academic_year: entry.label.replace(/^AVERAGE\s*-\s*/i, '').trim(),
              average: Number(entry.value),
            }))
            .filter((entry) => Number.isFinite(entry.average))
          const uploadedSummary = summaryEntries.length ? {
            year_averages: yearAverages,
            current_average: yearAverages[0]?.average,
            target_average: Number(summaryValue(/^TARGET AVERAGE/i)),
            students_attained: Number(summaryValue(/^NO\. OF STUDENTS ATTAINED/i)),
            total_students: Number(summaryValue(/^TOTAL STUDENTS APPEARED/i)),
            attainment_percentage: Number(summaryValue(/^% ATTAINMENT/i)),
            level: String(summaryValue(/^LEVEL$/i) || '').trim().toUpperCase(),
            level_point: Number(summaryValue(/^LEVEL POINT$/i)),
          } : null
          const rosterByRegistration = new Map(
            studentRoster.map((student) => [
              String(student.registration_no || student.regd_no || '').trim().toUpperCase(),
              student,
            ]),
          )
          const unknownRegistrations = []
          const duplicateRegistrations = new Set()
          const seenRegistrations = new Set()
          const invalidRows = []
          const parsedRows = studentRows
            .map((row, index) => {
              const rawSgpa = sgpaColumn >= 0 ? row[sgpaColumn] : ''
              const sgpa = String(rawSgpa).trim() === '' ? null : Number(rawSgpa)
              const excelGrade = String(gradeColumn >= 0 ? row[gradeColumn] : '').trim()
              const grade = normalizeGradeForDisplay(excelGrade || (sgpa !== null ? sgpaToGrade(sgpa) : ''))
              const uploadedBaseMark = baseMarkColumn >= 0 ? Number(row[baseMarkColumn]) : NaN
              const percentMark = Number.isFinite(uploadedBaseMark)
                ? uploadedBaseMark
                : excelGrade
                  ? gradeToPercentMark(excelGrade)
                : sgpa !== null
                  ? sgpaToPercentMark(sgpa)
                  : undefined
              const studentName = String(studentNameColumn >= 0 ? row[studentNameColumn] : '').trim()
              const regdNo = String(regdNoColumn >= 0 ? row[regdNoColumn] : '').trim()
              const normalizedRegdNo = regdNo.toUpperCase()
              const masterStudent = rosterByRegistration.get(normalizedRegdNo)

              if (normalizedRegdNo && seenRegistrations.has(normalizedRegdNo)) {
                duplicateRegistrations.add(regdNo)
                return null
              }
              seenRegistrations.add(normalizedRegdNo)

              if (regdNo && !masterStudent) {
                unknownRegistrations.push(regdNo)
                return null
              }

              if (!regdNo || !studentName || !grade || !Number.isFinite(percentMark)) {
                invalidRows.push(firstDataRowIndex + index + 1)
                return null
              }

              return {
                sl_no: Number(slNoColumn >= 0 ? row[slNoColumn] : '') || index + 1,
                regd_no: regdNo,
                student_name: masterStudent?.student_name || studentName,
                sgpa,
                grade,
                course_code:
                  String(getSheetValue(row, ['coursecode'])).trim() ||
                  selectedCourse?.course_code ||
                  '',
                course_name:
                  String(getSheetValue(row, ['coursename'])).trim() ||
                  selectedCourse?.course_name ||
                  '',
                percent_mark: Number(percentMark),
              }
            })
            .filter(Boolean)

          if (uploadedSummary && Object.values(uploadedSummary).some((value) =>
            typeof value === 'number' && Number.isNaN(value),
          )) {
            throw new Error('The lower Excel calculation section is incomplete or contains invalid values.')
          }

          if (!studentRoster.length) {
            throw new Error('No student master data found for the selected Department and Programme.')
          }

          if (unknownRegistrations.length) {
            throw new Error(`Registration number not found in Student Master: ${unknownRegistrations.join(', ')}`)
          }

          if (duplicateRegistrations.size) {
            throw new Error(`Duplicate registration number in Excel: ${[...duplicateRegistrations].join(', ')}`)
          }

          if (invalidRows.length) {
            throw new Error(`Invalid Excel data in row(s): ${invalidRows.join(', ')}. Check Regd. No., Student Name, and Grade.`)
          }

          if (!parsedRows.length) {
            throw new Error('No valid rows found. Required columns: Regd. No., Student Name, and Grade or SGPA.')
          }

          setMarkRows(parsedRows)
          setCalculationSummary(uploadedSummary)
          setPreviousAverageInputs({
            minus_two: uploadedSummary?.year_averages?.find((row) => row.academic_year === minusTwoAcademicYear)?.average ?? '',
            minus_one: uploadedSummary?.year_averages?.find((row) => row.academic_year === minusOneAcademicYear)?.average ?? '',
          })
          setMessage(`${parsedRows.length} external mark rows and the lower Excel calculation section were loaded.`)
        } catch (parseError) {
          setError(parseError.message)
        }
      }

      reader.readAsArrayBuffer(file)
    } catch (parseError) {
      setError(parseError.message)
    }
  }

  function downloadExternalMarksFormat() {
    const sampleRows = [[1, '2001206014', 'CHIRANJEEB NAYAK', 'B']]
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['SL. NO', 'REGD. NO.', 'STUDENT NAME', 'GRADE'],
      ...sampleRows,
    ])

    worksheet['!ref'] = `A1:D${sampleRows.length + 1}`
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'External Marks')
    XLSX.writeFile(workbook, 'external-mark-upload-format.xlsx')
  }

  async function saveExternalMarks() {
    setError('')
    setMessage('')

    if (!selection.department_id || !selection.programme_id || !selection.semester_id || !selection.course_id) {
      setError('Select Department, Programme, Semester, and Course before saving.')
      return
    }

    if (!selection.academic_year) {
      setError('Academic Year is not configured for the selected Semester.')
      return
    }

    if (!hasPreviousAverageInputs) {
      setError(`Enter the average values for ${minusTwoAcademicYear} and ${minusOneAcademicYear} before saving.`)
      return
    }

    if (!markRows.length) {
      setError('Import external marks Excel before saving.')
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch('/api/external-marks-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...selection,
          department_id: Number(selection.department_id),
          programme_id: Number(selection.programme_id),
          semester_id: Number(selection.semester_id),
          course_id: Number(selection.course_id),
          average_mark: Number(averageMark.toFixed(2)),
          target_average: Number(targetAverage.toFixed(2)),
          attainment_value: Number(attainmentValue.toFixed(5)),
          calculation_summary: currentCalculationSummary,
          rows: markRows,
        }),
      })
      const data = await readResponseJson(response)

      if (!response.ok) {
        throw new Error(data?.detail || data?.error || 'Unable to save external marks.')
      }

      const verifyResponse = await fetch(
        `/api/external-marks-upload?course_id=${selection.course_id}&academic_year=${encodeURIComponent(selection.academic_year)}`,
      )
      const verifiedRows = await readResponseJson(verifyResponse)
      if (!verifyResponse.ok) {
        throw new Error(verifiedRows?.detail || verifiedRows?.error || 'External marks were saved but could not be verified.')
      }
      if (verifiedRows.length !== markRows.length) {
        throw new Error(`Save verification failed: expected ${markRows.length} rows but found ${verifiedRows.length} rows in external_marks_upload.`)
      }

      setMessage(`${verifiedRows.length} external mark rows saved and verified in external_marks_upload.`)
      setSavedRows(verifiedRows)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="department-page co-po-page">
      <div className="section-title">
        <div>
          <p className="eyebrow">Dashboard / Assessment / External Mark Upload</p>
          <h3>External Mark Upload</h3>
        </div>
      </div>

      <div className="mapping-selector-grid">
        <label>
          <span>Department</span>
          <select name="department_id" value={selection.department_id} onChange={updateSelection}>
            <option value="">Select Department</option>
            {departments.map((department) => (
              <option key={department.department_id} value={department.department_id}>
                {department.department_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Programme</span>
          <select name="programme_id" value={selection.programme_id} onChange={updateSelection}>
            <option value="">Select Programme</option>
            {filteredProgrammes.map((programme) => (
              <option key={programme.programme_id} value={programme.programme_id}>
                {programme.programme_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Semester</span>
          <select name="semester_id" value={selection.semester_id} onChange={updateSelection}>
            <option value="">Select Semester</option>
            {filteredSemesters.map((semester) => (
              <option key={semester.semester_id} value={semester.semester_id}>
                {semester.semester_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Course</span>
          <select name="course_id" value={selection.course_id} onChange={updateSelection}>
            <option value="">Select Course</option>
            {filteredCourses.map((course) => (
              <option key={course.course_id} value={course.course_id}>
                {course.course_code} - {course.course_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Import Excel</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={parseExternalMarks} />
        </label>
      </div>

      {selection.academic_year && <div className="mapping-selector-grid external-average-input-grid">
        <label>
          <span>AVERAGE - {minusTwoAcademicYear}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={previousAverageInputs.minus_two}
            onChange={(event) => setPreviousAverageInputs((current) => ({ ...current, minus_two: event.target.value }))}
            placeholder={`Enter ${minusTwoAcademicYear} average`}
          />
        </label>
        <label>
          <span>AVERAGE - {minusOneAcademicYear}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={previousAverageInputs.minus_one}
            onChange={(event) => setPreviousAverageInputs((current) => ({ ...current, minus_one: event.target.value }))}
            placeholder={`Enter ${minusOneAcademicYear} average`}
          />
        </label>
      </div>}

      {selection.semester_id && (
        <div className={`notice ${selection.academic_year ? 'success' : 'error'}`}>
          {selection.academic_year
            ? `Academic Year: ${selection.academic_year} (automatically selected from Semester)`
            : 'Academic Year is not configured for the selected Semester.'}
        </div>
      )}

      <div className="mapping-actions">
        <button type="button" className="action-button" onClick={downloadExternalMarksFormat}>
          Download Excel Format
        </button>
        <button type="button" className="save-button" onClick={saveExternalMarks} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save External Marks'}
        </button>
        <span className="form-status">
          Columns: SL. NO, REGD. NO., STUDENT NAME, GRADE
        </span>
      </div>

      <div className="mapping-legend">
        <strong>Conversion of Grade to Mark as BPUT:</strong>
        <span>O = 100</span>
        <span>E = 80</span>
        <span>A = 70</span>
        <span>B = 60</span>
        <span>C = 50</span>
        <span>D = 40</span>
        <span>F(Ex) [External Evalution Mark] = 30</span>
        <span>S [ABSENT] = 0</span>
      </div>

      {isLoading && <div className="notice success">Loading data...</div>}
      {(message || error) && (
        <div className={`notice ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      <div className="table-panel">
        <div className="table-heading">
          <h4>External Marks Preview</h4>
          <span>{visibleMarkRows.length} records</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SL. NO</th>
                <th>REGD. NO.</th>
                <th>STUDENT NAME</th>
                <th>COURSE CODE</th>
                <th>COURSE NAME</th>
                <th>GRADE</th>
                <th>MARK</th>
              </tr>
            </thead>
            <tbody>
              {visibleMarkRows.map((row, index) => (
                <tr key={`${row.regd_no}-${index}`}>
                  <td>{row.sl_no || index + 1}</td>
                  <td>{row.regd_no}</td>
                  <td>{row.student_name}</td>
                  <td>{row.course_code || selectedCourse?.course_code || '-'}</td>
                  <td>{row.course_name || selectedCourse?.course_name || '-'}</td>
                  <td>{row.grade || '-'}</td>
                  <td>{row.percent_mark === null || row.percent_mark === '' ? '-' : Number(row.percent_mark).toFixed(2)}</td>
                </tr>
              ))}
              {!visibleMarkRows.length && (
                <tr>
                    <td colSpan="7" className="empty-cell">
                      Import external marks Excel to calculate average.
                    </td>
                </tr>
              )}
              {!!calculationRows.length && (
                <>
                  {(currentCalculationSummary.year_averages.length
                    ? currentCalculationSummary.year_averages
                    : [{ academic_year: selection.academic_year, average: averageMark }]
                  ).map((row) => <tr className="summary-row external-summary-row" key={row.academic_year}>
                    <td colSpan="6">AVERAGE - {row.academic_year}</td>
                    <td>{Number(row.average).toFixed(2)}</td>
                  </tr>)}
                  <tr className="summary-row external-summary-row">
                    <td colSpan="6">TARGET AVERAGE = (AVERAGE OF LAST 2 YEARS)</td>
                    <td>{targetAverage.toFixed(2)}</td>
                  </tr>
                  <tr className="summary-row external-summary-row">
                    <td colSpan="6">NO. OF STUDENTS ATTAINED THE TARGET</td>
                    <td>{studentsAboveTarget}</td>
                  </tr>
                  <tr className="summary-row external-summary-row">
                    <td colSpan="6">TOTAL STUDENTS APPEARED</td>
                    <td>{totalStudentsAppeared}</td>
                  </tr>
                  <tr className="summary-row external-summary-row">
                    <td colSpan="6">% ATTAINMENT</td>
                    <td>{hasPreviousAverageInputs ? Math.round(attainmentValue) : attainmentValue.toFixed(2)}</td>
                  </tr>
                  <tr className="summary-row external-summary-row">
                    <td colSpan="6">LEVEL</td>
                    <td>{attainmentLevel}</td>
                  </tr>
                  <tr className="summary-row external-summary-row">
                    <td colSpan="6">LEVEL POINT</td>
                    <td>{attainmentLevelPoint}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function ImportFacultyPage() {
  const [departments, setDepartments] = useState([])
  const [departmentId, setDepartmentId] = useState('')
  const [file, setFile] = useState(null)
  const [fileKey, setFileKey] = useState(0)
  const [previewRows, setPreviewRows] = useState([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    fetch('/api/departments').then(async (response) => {
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load departments.')
      setDepartments(data || [])
      setDepartmentId(String(data?.[0]?.department_id || ''))
    }).catch((loadError) => setError(loadError.message))
  }, [])

  function downloadTemplate() {
    const rows = [
      { 'Faculty Code': 'FAC-CSE-001', 'Faculty Name': 'Dr. A. Kumar', Designation: 'Associate Professor', 'Department Code': 'CSE', Username: 'akumar', Email: 'akumar@college.edu', Status: 'Active' },
      { 'Faculty Code': 'FAC-CSE-002', 'Faculty Name': 'Dr. B. Das', Designation: 'Assistant Professor', 'Department Code': 'CSE', Username: 'bdas', Email: 'bdas@college.edu', Status: 'Active' },
    ]
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet(rows, { header: ['Faculty Code', 'Faculty Name', 'Designation', 'Department Code', 'Username', 'Email', 'Status'] })
    sheet['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 20 }, { wch: 18 }, { wch: 30 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(workbook, sheet, 'Faculty')
    XLSX.writeFile(workbook, 'Faculty_Import_Template.xlsx')
  }

  async function uploadOrSave() {
    setMessage(''); setError('')
    if (!departmentId) { setError('Select a Department.'); return }
    if (!previewRows.length) {
      if (!file) { setError('Choose an .xlsx Excel file.'); return }
      try {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        const parsed = rows.map((row, index) => {
          const parsedRow = {
            faculty_code: String(getSheetValue(row, ['facultycode'])).trim(),
            faculty_name: String(getSheetValue(row, ['facultyname'])).trim(),
            designation: String(getSheetValue(row, ['designation'])).trim(),
            department_code: String(getSheetValue(row, ['departmentcode'])).trim(),
            login_username: String(getSheetValue(row, ['username'])).trim(),
            email: String(getSheetValue(row, ['email'])).trim(),
            status: String(getSheetValue(row, ['status']) || 'Active').trim(),
          }
          if (Object.values(parsedRow).some((value) => !value)) throw new Error(`Row ${index + 2}: all template columns are required.`)
          return parsedRow
        })
        if (!parsed.length) throw new Error('Excel sheet has no faculty rows.')
        setPreviewRows(parsed)
        setMessage(`${parsed.length} faculty rows ready for preview. Review and click Save to Database.`)
      } catch (parseError) { setError(parseError.message) }
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch('/api/faculty-management/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department_id: Number(departmentId), rows: previewRows }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to import faculty.')
      setMessage(data?.message || 'Faculty imported successfully.')
      setPreviewRows([]); setFile(null); setFileKey((current) => current + 1)
    } catch (saveError) { setError(saveError.message) } finally { setIsSaving(false) }
  }

  function resetUpload() {
    setFile(null); setPreviewRows([]); setMessage(''); setError(''); setFileKey((current) => current + 1)
  }

  return (
    <section className="department-page">
      <div className="section-title"><div><p className="eyebrow">Faculty Management</p><h3>Faculty Excel Upload</h3></div></div>
      <div className="department-form faculty-upload-form">
        <div className="form-heading"><h4>Faculty Excel Upload</h4><span>Bulk faculty import</span></div>
        <label><span>Department</span><select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setPreviewRows([]) }}><option value="">Select Department</option>{departments.map((row) => <option key={row.department_id} value={row.department_id}>{row.department_name}</option>)}</select></label>
        <label><span>Excel File</span><input key={fileKey} type="file" accept=".xlsx" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreviewRows([]); setMessage(''); setError('') }} /></label>
        <div className="allowed-format"><strong>Allowed Format</strong><span>.xlsx</span></div>
        <div className="form-actions"><button type="button" className="reset-button" onClick={downloadTemplate}>Download Template</button><button type="button" className="save-button" onClick={uploadOrSave} disabled={isSaving}>{isSaving ? 'Saving...' : previewRows.length ? 'Save to Database' : 'Upload & Preview'}</button><button type="button" className="reset-button" onClick={resetUpload}>Reset</button></div>
      </div>
      {(message || error) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || message}</div>}
      {previewRows.length > 0 && <div className="table-panel"><div className="table-heading"><h4>Faculty Preview</h4><span>{previewRows.length} rows</span></div><div className="table-wrap"><table><thead><tr><th>Faculty Code</th><th>Faculty Name</th><th>Designation</th><th>Department Code</th><th>Username</th><th>Email</th><th>Status</th></tr></thead><tbody>{previewRows.map((row, index) => <tr key={`${row.faculty_code}-${index}`}><td>{row.faculty_code}</td><td>{row.faculty_name}</td><td>{row.designation}</td><td>{row.department_code}</td><td>{row.login_username}</td><td>{row.email}</td><td>{row.status}</td></tr>)}</tbody></table></div></div>}
    </section>
  )
}

function AddFacultyPage() {
  const emptyForm = {
    department_id: '', faculty_code: '', faculty_name: '', designation: 'Associate Professor',
    login_username: '', email: '', status: 'Active', create_login: true, initial_password: '',
  }
  const [departments, setDepartments] = useState([])
  const [facultyRows, setFacultyRows] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const responses = await Promise.all(['/api/departments', '/api/faculty-management'].map((url) => fetch(url)))
      const data = await Promise.all(responses.map((response) => readResponseJson(response)))
      const failedIndex = responses.findIndex((response) => !response.ok)
      if (failedIndex >= 0) throw new Error(data[failedIndex]?.detail || data[failedIndex]?.error || 'Unable to load faculty data.')
      setDepartments(data[0] || [])
      setFacultyRows(data[1] || [])
      setForm((current) => ({ ...current, department_id: current.department_id || String(data[0]?.[0]?.department_id || '') }))
    } catch (loadError) {
      setError(loadError.message)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  function updateField(event) {
    const { name, value, type, checked } = event.target
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  function resetForm() {
    setEditingId(null)
    setForm({ ...emptyForm, department_id: String(departments[0]?.department_id || '') })
    setMessage('')
    setError('')
  }

  function editFaculty(row) {
    setEditingId(row.faculty_id)
    setForm({
      department_id: String(row.department_id || ''), faculty_code: row.faculty_code || '',
      faculty_name: row.faculty_name || '', designation: row.designation || 'Associate Professor',
      login_username: row.login_username || '', email: row.email || '', status: row.status || 'Active',
      create_login: Boolean(row.create_login), initial_password: '',
    })
    setMessage('')
    setError('')
  }

  async function saveFaculty(event) {
    event.preventDefault()
    setIsSaving(true); setMessage(''); setError('')
    try {
      const response = await fetch(editingId ? `/api/faculty-management/${editingId}` : '/api/faculty-management', {
        method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, department_id: Number(form.department_id) }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to save faculty.')
      const savedMessage = data?.message || (editingId ? 'Faculty updated.' : 'Faculty saved.')
      resetForm()
      setMessage(savedMessage)
      await loadData()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="department-page">
      <div className="section-title"><div><p className="eyebrow">Faculty Management</p><h3>Add / Edit Faculty</h3></div></div>
      <form className="department-form faculty-form" onSubmit={saveFaculty}>
        <div className="form-heading"><h4>Add / Edit Faculty</h4><span>{editingId ? `Editing #${editingId}` : 'New record'}</span></div>
        <label><span>Department</span><select name="department_id" value={form.department_id} onChange={updateField} required><option value="">Select Department</option>{departments.map((row) => <option key={row.department_id} value={row.department_id}>{row.department_name}</option>)}</select></label>
        <label><span>Faculty Code</span><input name="faculty_code" value={form.faculty_code} onChange={updateField} placeholder="FAC-CSE-001" required /></label>
        <label><span>Faculty Name</span><input name="faculty_name" value={form.faculty_name} onChange={updateField} placeholder="Dr. A. Kumar" required /></label>
        <label><span>Designation</span><select name="designation" value={form.designation} onChange={updateField}><option>Professor</option><option>Associate Professor</option><option>Assistant Professor</option><option>Lecturer</option><option>Visiting Faculty</option></select></label>
        <label><span>Login Username</span><input name="login_username" value={form.login_username} onChange={updateField} placeholder="akumar" required={form.create_login} /></label>
        <label><span>Email</span><input type="email" name="email" value={form.email} onChange={updateField} placeholder="akumar@college.edu" required /></label>
        <label><span>Status</span><select name="status" value={form.status} onChange={updateField}><option>Active</option><option>Inactive</option></select></label>
        <label className="faculty-checkbox"><span>Create Login</span><input type="checkbox" name="create_login" checked={form.create_login} onChange={updateField} /></label>
        <label><span>Initial Password</span><input type="password" name="initial_password" value={form.initial_password} onChange={updateField} placeholder={editingId ? 'Leave blank to keep password' : 'Enter initial password'} required={form.create_login && !editingId} disabled={!form.create_login} /></label>
        <div className="form-actions"><button type="submit" className="save-button" disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Faculty'}</button><button type="button" className="reset-button" onClick={resetForm}>Reset</button></div>
      </form>
      {(message || error) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || message}</div>}
      <div className="table-panel"><div className="table-heading"><h4>Faculty List</h4><span>{facultyRows.length} records</span></div><div className="table-wrap"><table><thead><tr><th>Sl.No</th><th>Faculty Code</th><th>Faculty Name</th><th>Department</th><th>Designation</th><th>Email</th><th>Status</th><th>Login</th><th>Action</th></tr></thead><tbody>
        {facultyRows.map((row, index) => <tr key={row.faculty_id}><td>{index + 1}</td><td>{row.faculty_code || '-'}</td><td>{row.faculty_name}</td><td>{row.department_code || row.department_name || '-'}</td><td>{row.designation || '-'}</td><td>{row.email || '-'}</td><td><span className={`status-badge ${String(row.status).toLowerCase()}`}>{row.status}</span></td><td>{row.create_login ? 'Yes' : 'No'}</td><td><button type="button" onClick={() => editFaculty(row)}>Edit</button></td></tr>)}
        {!facultyRows.length && <tr><td colSpan="9" className="empty-cell">No faculty records found.</td></tr>}
      </tbody></table></div></div>
    </section>
  )
}

function FacultyLoginMappingPage() {
  const emptyForm = { faculty_name: '', email: '', password: '', role: 'User', status: 'Active' }
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const loadMappings = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/faculty-login-mapping')
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load faculty login mappings.')
      setRows(data || [])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadMappings() }, [loadMappings])

  function updateForm(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  function resetForm() {
    setForm(emptyForm)
    setEditingId(null)
    setError('')
  }

  function editMapping(row) {
    setEditingId(row.user_id)
    setForm({
      faculty_name: row.faculty_name || '', email: row.email || '', password: '',
      role: row.role || 'User', status: row.status || 'Active',
    })
    setMessage('')
    setError('')
  }

  async function saveMapping(event) {
    event.preventDefault()
    if (!form.faculty_name.trim() || !form.email.trim() || (!editingId && !form.password)) {
      setError(`Faculty Name, Email, and ${editingId ? '' : 'Password '}are required.`)
      return
    }
    setIsSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch(editingId
        ? `/api/faculty-login-mapping/${editingId}`
        : '/api/faculty-login-mapping', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to save faculty login mapping.')
      setMessage(data?.message || 'Faculty login mapping saved.')
      setForm(emptyForm)
      setEditingId(null)
      await loadMappings()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="page-section">
      <div className="section-title"><div><span>Settings</span><h3>Faculty Login Mapping</h3><p>Create and maintain faculty login accounts.</p></div></div>
      <form className="department-form" onSubmit={saveMapping}>
        <div className="form-grid">
          <label><span>Faculty Name</span><input name="faculty_name" value={form.faculty_name} onChange={updateForm} placeholder="Enter faculty name" /></label>
          <label><span>Login Email</span><input name="email" type="email" value={form.email} onChange={updateForm} placeholder="faculty@abit.edu" /></label>
          <label><span>Password</span><input name="password" type="password" value={form.password} onChange={updateForm} placeholder={editingId ? 'Leave blank to keep password' : 'Enter password'} /></label>
          <label><span>Role</span><select name="role" value={form.role} onChange={updateForm}><option>User</option><option>Admin</option></select></label>
          <label><span>Status</span><select name="status" value={form.status} onChange={updateForm}><option>Active</option><option>Inactive</option></select></label>
        </div>
        <div className="mapping-actions">
          <button type="submit" className="save-button" disabled={isSaving}>{isSaving ? 'Saving...' : editingId ? 'Update Mapping' : 'Save Mapping'}</button>
          <button type="button" className="reset-button" onClick={resetForm}>Reset</button>
        </div>
      </form>
      {(message || error) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || message}</div>}
      <div className="table-panel"><div className="table-heading"><h4>Faculty Login Mapping Records</h4><span>{isLoading ? 'Loading...' : `${rows.length} records`}</span></div><div className="table-wrap">
        <table><thead><tr><th>Sl. No.</th><th>Faculty Name</th><th>Login Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.user_id}><td>{index + 1}</td><td>{row.faculty_name}</td><td>{row.email}</td><td>{row.role}</td><td><span className={`status-badge ${String(row.status).toLowerCase()}`}>{row.status}</span></td><td><button type="button" onClick={() => editMapping(row)}>Edit</button></td></tr>)}
          {!rows.length && !isLoading && <tr><td colSpan="6" className="empty-cell">No faculty login mappings found.</td></tr>}</tbody>
        </table>
      </div></div>
    </section>
  )
}

function FacultyPermissionManagementPage() {
  const permissionAcademicYears = Array.from({ length: 11 }, (_, index) => {
    const startYear = 2023 + index
    return `${startYear}-${String(startYear + 1).slice(-2)}`
  })
  const permissionKeys = [
    ['can_view', 'View'], ['can_create', 'Create'], ['can_edit', 'Edit'],
    ['can_delete', 'Delete'], ['can_upload', 'Upload'],
    ['can_calculate', 'Calculate'], ['can_export', 'Export'],
  ]
  const [facultyRows, setFacultyRows] = useState([])
  const [departments, setDepartments] = useState([])
  const [permissions, setPermissions] = useState([])
  const [userId, setUserId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [academicYear, setAcademicYear] = useState('2023-24')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const selectedFaculty = useMemo(() => facultyRows.find((row) => String(row.user_id) === userId), [facultyRows, userId])

  useEffect(() => {
    Promise.all(['/api/faculty-management', '/api/departments'].map(async (url) => {
      const response = await fetch(url)
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load permission masters.')
      return data
    })).then(([facultyData, departmentData]) => {
      const activeFaculty = (facultyData || []).filter((row) => row.status === 'Active' && row.user_id)
      setFacultyRows(activeFaculty)
      setDepartments(departmentData || [])
    }).catch((loadError) => setError(loadError.message))
  }, [])

  useEffect(() => {
    if (!userId || !departmentId) { setPermissions([]); return }
    setIsLoading(true); setError(''); setMessage('')
    fetch(`/api/faculty-permissions?user_id=${userId}&department_id=${departmentId}&academic_year=${encodeURIComponent(academicYear)}`)
      .then(async (response) => {
        const data = await readResponseJson(response)
        if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load permissions.')
        setPermissions((data || []).filter((row) => !['gap analysis', 'nba reports'].includes(String(row.module_name || '').trim().toLowerCase())))
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setIsLoading(false))
  }, [academicYear, departmentId, userId])

  function togglePermission(moduleId, key) {
    setPermissions((current) => current.map((row) => {
      if (row.module_id !== moduleId) return row
      const nextValue = !row[key]
      if (key === 'can_view' && !nextValue) {
        return {
          ...row, can_view: false, can_create: false, can_edit: false, can_delete: false,
          can_upload: false, can_calculate: false, can_export: false,
        }
      }
      return { ...row, [key]: nextValue, can_view: key === 'can_view' ? nextValue : (nextValue || row.can_view) }
    }))
  }

  function toggleAllModulePermissions(moduleId) {
    setPermissions((current) => current.map((row) => {
      if (row.module_id !== moduleId) return row
      const enableAll = !permissionKeys.every(([key]) => Boolean(row[key]))
      return permissionKeys.reduce((next, [key]) => ({ ...next, [key]: enableAll }), { ...row })
    }))
  }

  function toggleAllPermissions() {
    const activateAll = !permissions.every((row) =>
      permissionKeys.every(([key]) => Boolean(row[key])),
    )
    setPermissions((current) => current.map((row) =>
      permissionKeys.reduce((next, [key]) => ({ ...next, [key]: activateAll }), { ...row }),
    ))
    setMessage('')
    setError('')
  }

  async function savePermissions() {
    if (!userId || !departmentId || !permissions.length) { setError('Select a Faculty and Department before saving permissions.'); return }
    setIsSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/faculty-permissions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: Number(userId), department_id: Number(departmentId), academic_year: academicYear, permissions }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to save permissions.')
      setMessage(data?.message || 'Faculty permissions saved.')
    } catch (saveError) { setError(saveError.message) } finally { setIsSaving(false) }
  }

  return (
    <section className="page-section">
      <div className="section-title"><div><span>Settings</span><h3>Faculty Permission Management</h3><p>Manage module and action access for each faculty login.</p></div></div>
      <div className="mapping-selector-grid">
        <label><span>Faculty</span><select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Select Faculty</option>{facultyRows.map((row) => <option key={row.user_id} value={row.user_id}>{row.faculty_name}</option>)}</select></label>
        <label><span>Username</span><input value={selectedFaculty?.login_username || selectedFaculty?.email?.split('@')[0] || ''} readOnly /></label>
        <label><span>Department</span><select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">Select Department</option>{departments.map((row) => <option key={row.department_id} value={row.department_id}>{row.department_code} - {row.department_name}</option>)}</select></label>
        <label><span>Academic Year</span><select value={academicYear} onChange={(event) => setAcademicYear(event.target.value)}>{permissionAcademicYears.map((year) => <option key={year}>{year}</option>)}</select></label>
      </div>
      <div className="table-panel"><div className="table-heading"><h4>Module Permissions</h4><span>{isLoading ? 'Loading...' : `${permissions.length} modules`}</span></div><div className="table-wrap">
        <table className="permission-table"><thead><tr><th>Module</th><th><label className="permission-select-all"><input type="checkbox" aria-label="Activate all module permissions" checked={Boolean(permissions.length) && permissions.every((row) => permissionKeys.every(([key]) => Boolean(row[key])))} onChange={toggleAllPermissions} disabled={!permissions.length} /> Activate All</label></th>{permissionKeys.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{permissions.map((row) => <tr key={row.module_id}><th>{row.module_name}</th><td><input type="checkbox" aria-label={`${row.module_name} Select All`} checked={permissionKeys.every(([key]) => Boolean(row[key]))} onChange={() => toggleAllModulePermissions(row.module_id)} /></td>{permissionKeys.map(([key, label]) => <td key={`${row.module_id}-${key}`}><input type="checkbox" aria-label={`${row.module_name} ${label}`} checked={Boolean(row[key])} onChange={() => togglePermission(row.module_id, key)} /></td>)}</tr>)}
          {!permissions.length && !isLoading && <tr><td colSpan="9" className="empty-cell">Select an active faculty login to manage permissions.</td></tr>}</tbody>
        </table>
      </div></div>
      <div className="mapping-actions"><button type="button" className="save-button" onClick={savePermissions} disabled={isSaving || !userId || !departmentId}>{isSaving ? 'Saving...' : 'Save Permissions'}</button></div>
      {(message || error) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || message}</div>}
    </section>
  )
}

function AssignedCoursesPage() {
  const [facultyRows, setFacultyRows] = useState([])
  const [programmes, setProgrammes] = useState([])
  const [semesters, setSemesters] = useState([])
  const [userId, setUserId] = useState('')
  const [programmeId, setProgrammeId] = useState('')
  const [semesterId, setSemesterId] = useState('')
  const [courseRows, setCourseRows] = useState([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const selectedFaculty = useMemo(() => facultyRows.find((row) => String(row.user_id) === userId), [facultyRows, userId])
  const filteredSemesters = useMemo(() => semesters.filter((row) => String(row.programme_id) === programmeId), [semesters, programmeId])

  useEffect(() => {
    Promise.all(['/api/faculty-login-mapping', '/api/programmes', '/api/semesters'].map(async (url) => {
      const response = await fetch(url)
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load assigned-course masters.')
      return data
    })).then(([facultyData, programmeData, semesterData]) => {
      const activeFaculty = (facultyData || []).filter((row) => row.role !== 'Admin' && row.status === 'Active')
      setFacultyRows(activeFaculty); setProgrammes(programmeData || []); setSemesters(semesterData || [])
      if (activeFaculty.length) setUserId(String(activeFaculty[0].user_id))
      if (programmeData?.length) setProgrammeId(String(programmeData[0].programme_id))
    }).catch((loadError) => setError(loadError.message))
  }, [])

  useEffect(() => {
    if (filteredSemesters.length && !filteredSemesters.some((row) => String(row.semester_id) === semesterId)) {
      setSemesterId(String(filteredSemesters[0].semester_id))
    }
  }, [filteredSemesters, semesterId])

  useEffect(() => {
    if (!userId || !selectedFaculty?.faculty_id || !programmeId || !semesterId) { setCourseRows([]); return }
    setIsLoading(true); setError(''); setMessage('')
    fetch(`/api/faculty-course-assignments?faculty_id=${selectedFaculty.faculty_id}&programme_id=${programmeId}&semester_id=${semesterId}&academic_year=2025-26`)
      .then(async (response) => {
        const data = await readResponseJson(response)
        if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to load course assignments.')
        setCourseRows(data || [])
      }).catch((loadError) => setError(loadError.message)).finally(() => setIsLoading(false))
  }, [programmeId, selectedFaculty?.faculty_id, semesterId, userId])

  function updateCourse(courseId, changes) {
    setCourseRows((current) => current.map((row) => row.course_id === courseId ? { ...row, ...changes } : row))
  }

  async function saveAssignments() {
    setIsSaving(true); setError(''); setMessage('')
    if (!selectedFaculty?.faculty_id) {
      setIsSaving(false)
      setError('This login email is not linked to a Faculty master record. Use the same email in Faculty and Faculty Login Mapping.')
      return
    }
    try {
      const response = await fetch('/api/faculty-course-assignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: Number(userId), faculty_id: Number(selectedFaculty.faculty_id),
          programme_id: Number(programmeId), semester_id: Number(semesterId), academic_year: '2025-26',
          assignments: courseRows.filter((row) => row.selected).map((row) => ({
            course_id: row.course_id, section: row.section || 'A', is_coordinator: Boolean(row.is_coordinator),
          })),
        }),
      })
      const data = await readResponseJson(response)
      if (!response.ok) throw new Error(data?.detail || data?.error || 'Unable to save course assignments.')
      setMessage(data?.message || 'Faculty course mapping and permissions saved.')
    } catch (saveError) { setError(saveError.message) } finally { setIsSaving(false) }
  }

  return (
    <section className="page-section">
      <div className="section-title"><div><span>Settings</span><h3>Assigned Courses</h3><p>Map courses and coordinator responsibility to faculty logins.</p></div></div>
      <div className="mapping-selector-grid">
        <label><span>Faculty</span><select value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Select Faculty</option>{facultyRows.map((row) => <option key={row.user_id} value={row.user_id}>{row.faculty_name}</option>)}</select></label>
        <label><span>Programme</span><select value={programmeId} onChange={(event) => { setProgrammeId(event.target.value); setSemesterId('') }}><option value="">Select Programme</option>{programmes.map((row) => <option key={row.programme_id} value={row.programme_id}>{row.programme_name}</option>)}</select></label>
        <label><span>Semester</span><select value={semesterId} onChange={(event) => setSemesterId(event.target.value)}><option value="">Select Semester</option>{filteredSemesters.map((row) => <option key={row.semester_id} value={row.semester_id}>{row.semester_name}</option>)}</select></label>
      </div>
      <div className="table-panel"><div className="table-heading"><h4>Assigned Courses</h4><span>{isLoading ? 'Loading...' : `${courseRows.length} courses`}</span></div><div className="table-wrap">
        <table className="permission-table"><thead><tr><th>Select</th><th>Dept</th><th>Programme</th><th>Sem</th><th>Course Code</th><th>Course Name</th><th>Section</th><th>Coordinator</th></tr></thead>
          <tbody>{courseRows.map((row) => <tr key={row.course_id}><td><input type="checkbox" checked={Boolean(row.selected)} onChange={(event) => updateCourse(row.course_id, { selected: event.target.checked, is_coordinator: event.target.checked ? row.is_coordinator : false })} /></td><td>{row.department_code || row.department_name || '-'}</td><td>{row.programme_name || '-'}</td><td>{row.semester_name || '-'}</td><td>{row.course_code}</td><td>{row.course_name}</td><td><input value={row.section || 'A'} onChange={(event) => updateCourse(row.course_id, { section: event.target.value })} disabled={!row.selected} /></td><td><input type="checkbox" checked={Boolean(row.is_coordinator)} disabled={!row.selected} onChange={(event) => updateCourse(row.course_id, { is_coordinator: event.target.checked })} /></td></tr>)}
          {!courseRows.length && !isLoading && <tr><td colSpan="8" className="empty-cell">Select Faculty, Programme, and Semester to view courses.</td></tr>}</tbody>
        </table>
      </div></div>
      <div className="mapping-actions"><button type="button" className="save-button" disabled={isSaving || !userId || !semesterId} onClick={saveAssignments}>{isSaving ? 'Saving...' : 'Save Faculty Mapping and Permissions'}</button></div>
      {(message || error) && <div className={`notice ${error ? 'error' : 'success'}`}>{error || message}</div>}
    </section>
  )
}

function App() {
  const [auth, setAuth] = useState(() => {
    if (typeof window === 'undefined') {
      return null
    }

    const storedAuth = window.localStorage.getItem('obeAuth')
    return storedAuth ? JSON.parse(storedAuth) : null
  })
  const [activeItem, setActiveItem] = useState(activeItemFromHash)
  const [expandedMenus, setExpandedMenus] = useState({})
  const authorizedModules = useMemo(
    () => (auth?.user?.role === 'Admin' ? allMenuLabels : auth?.modules || []),
    [auth],
  )
  const accessibleMenuItems = useMemo(
    () => filterMenuItemsByModules(menuItems, authorizedModules),
    [authorizedModules],
  )
  const accessibleFlatMenuItems = useMemo(
    () => accessibleMenuItems.flatMap((item) => [item, ...(item.children || [])]),
    [accessibleMenuItems],
  )
  const selectedItem = useMemo(
    () => accessibleFlatMenuItems.find((item) => item.label === activeItem) || accessibleFlatMenuItems[0] || menuItems[0],
    [accessibleFlatMenuItems, activeItem],
  )
  const activePermission = useMemo(
    () => (auth?.permissions || []).find((row) => row.module_name === activeItem),
    [activeItem, auth?.permissions],
  )
  const isViewOnly = auth?.user?.role !== 'Admin' && Boolean(activePermission?.can_view) &&
    !['can_create', 'can_edit', 'can_delete', 'can_upload', 'can_calculate', 'can_export']
      .some((key) => Boolean(activePermission?.[key]))

  useEffect(() => {
    if (!auth?.user?.user_id || auth.user.role === 'Admin') return
    Promise.all([fetch(`/api/user-modules/${auth.user.user_id}`), fetch(`/api/user-permissions/${auth.user.user_id}`)])
      .then(async ([moduleResponse, permissionResponse]) => {
        const [modules, permissions] = await Promise.all([readResponseJson(moduleResponse), readResponseJson(permissionResponse)])
        if (!moduleResponse.ok || !Array.isArray(modules)) return
        setAuth((current) => {
          if (!current) return current
          const next = { ...current, modules, permissions: permissionResponse.ok && Array.isArray(permissions) ? permissions : [] }
          window.localStorage.setItem('obeAuth', JSON.stringify(next))
          return next
        })
      })
      .catch(() => {})
  }, [auth?.user?.role, auth?.user?.user_id])

  useEffect(() => {
    function syncHashNavigation() {
      setActiveItem(activeItemFromHash())
    }

    syncHashNavigation()
    window.addEventListener('hashchange', syncHashNavigation)

    return () => window.removeEventListener('hashchange', syncHashNavigation)
  }, [])

  useEffect(() => {
    if (!auth || !accessibleFlatMenuItems.length) {
      return
    }

    const hasAccess = accessibleFlatMenuItems.some((item) => item.label === activeItem)

    if (!hasAccess) {
      navigateTo(accessibleFlatMenuItems[0].label)
    }
  }, [accessibleFlatMenuItems, activeItem, auth])

  function handleLogin(loginData) {
    setAuth(loginData)
    window.localStorage.setItem('obeAuth', JSON.stringify(loginData))
    const loginModules = loginData.user?.role === 'Admin' ? allMenuLabels : loginData.modules || []
    const firstModule = filterMenuItemsByModules(menuItems, loginModules)[0]
    navigateTo(firstModule?.label || 'Dashboard')
  }

  function logout() {
    window.localStorage.removeItem('obeAuth')
    setAuth(null)
    window.history.pushState(null, '', window.location.pathname)
  }

  function navigateTo(label) {
    setActiveItem(label)

    const nextHash = menuHash(label)
    if (window.location.hash.toLowerCase() !== nextHash) {
      window.history.pushState(null, '', nextHash)
    }
  }

  function toggleMenu(label) {
    setExpandedMenus((current) => ({
      ...current,
      [label]: !current[label],
    }))
  }

  if (!auth) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <main className="app-shell">
      <aside className="side-menu" aria-label="OBE navigation">
        <div className="brand-block">
          <img className="brand-logo" src={logoImage} alt="ABIT logo" />
          <div className="brand-mark">ABIT OBE</div>
        </div>

        <nav className="nav-list">
          {accessibleMenuItems.map((item) => {
            const isChildActive = item.children?.some((child) => child.label === activeItem)
            const isExpanded = Boolean(expandedMenus[item.label])

            return (
              <div className="nav-group" key={item.label}>
                <button
                  type="button"
                  className={`nav-item ${
                    activeItem === item.label || isChildActive ? 'active' : ''
                  }`}
                  onClick={() => (item.children?.length ? toggleMenu(item.label) : navigateTo(item.label))}
                  aria-current={activeItem === item.label ? 'page' : undefined}
                  aria-expanded={item.children?.length ? isExpanded : undefined}
                >
                  <span className="nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="nav-copy">
                    <span>{item.label}</span>
                  </span>
                  {item.children?.length ? (
                    <span className={`nav-caret ${isExpanded ? 'open' : ''}`} aria-hidden="true">
                      ▾
                    </span>
                  ) : null}
                </button>

                {item.children?.length && isExpanded && (
                  <div className="nav-sublist">
                    {item.children.map((child) => (
                      <button
                        type="button"
                        key={child.label}
                        className={`nav-subitem ${
                          activeItem === child.label ? 'active' : ''
                        }`}
                        onClick={() => navigateTo(child.label)}
                        aria-current={activeItem === child.label ? 'page' : undefined}
                      >
                        <span aria-hidden="true">{child.icon}</span>
                        {child.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
        <div className="session-box">
          <span>{auth.user?.role}</span>
          <strong>{auth.user?.full_name || auth.user?.email}</strong>
          <button type="button" onClick={logout}>Logout</button>
        </div>
      </aside>

      <section className={`workspace ${isViewOnly ? 'view-only-workspace' : ''}`}>
        {activeItem === 'Departments' ? (
          <DepartmentsPage />
        ) : activeItem === 'Department Vision and Mission' ? (
          <DepartmentVisionMissionPage user={auth.user} />
        ) : activeItem === 'Programmes' ? (
          <ProgrammesPage />
        ) : activeItem === 'Admission Batch Management' ? (
          <AdmissionBatchManagementPage />
        ) : activeItem === 'Semester' ? (
          <SemestersPage />
        ) : activeItem === 'Courses' ? (
          <CoursesPage />
        ) : activeItem === 'Set Target' ? (
          <AssessmentsPage />
        ) : activeItem === 'Course Outcomes' ? (
          <CourseOutcomesPage />
        ) : activeItem === 'PO/PSO/PEO' ? (
          <ProgrammeOutcomesPage user={auth.user} />
        ) : activeItem === 'CO-PO Mapping' ? (
          <CoPoMappingPage user={auth.user} />
        ) : activeItem === 'CO-PO Attainment' ? (
          <CoPoAttainmentPage />
        ) : activeItem === 'CO-PSO Attainment' ? (
          <CoPsoAttainmentPage />
        ) : activeItem === 'Articulation Matrix' ? (
          <ArticulationMatrixPage />
        ) : activeItem === 'Mark Attainment' ? (
          <MarkAttainmentPage />
        ) : activeItem === 'CO Attainment Calculation' ? (
          <CoAttainmentCalculationPage />
        ) : activeItem === 'University Mapping Question' ? (
          <UniversityMappingQuestionPage user={auth.user} />
        ) : activeItem === 'Internal Mark Upload' ? (
          <InternalMarkUploadPage />
        ) : activeItem === 'External Mark Upload' ? (
          <ExternalMarkUploadPage />
        ) : activeItem === 'Add Faculty' ? (
          <AddFacultyPage />
        ) : activeItem === 'Import Faculty' ? (
          <ImportFacultyPage />
        ) : activeItem === 'Faculty Login Mapping' ? (
          <FacultyLoginMappingPage />
        ) : activeItem === 'Faculty Permission Management' ? (
          <FacultyPermissionManagementPage />
        ) : activeItem === 'Assigned Courses' ? (
          <AssignedCoursesPage />
        ) : activeItem === 'Import Student' ? (
          <StudentMasterPage />
        ) : activeItem === 'Student Course Faculty Mapping' ? (
          <StudentCourseFacultyMappingPage />
        ) : ['All Departments', 'Department Wise', 'Course Wise'].includes(activeItem) ? (
          <SubjectWiseReportPage reportName={activeItem} user={auth.user} />
        ) : activeItem === 'Report' ? (
          <ReportPage />
        ) : activeItem === 'Dashboard' ? (
          <DashboardPage user={auth.user} />
        ) : (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">Active module</p>
                <h2>
                  <span aria-hidden="true">{selectedItem.icon}</span>
                  {selectedItem.label}
                </h2>
              </div>
              <button
                type="button"
                className="action-button"
                onClick={() => navigateTo('Departments')}
              >
                New Entry
              </button>
            </header>

            <section className="summary-band" aria-label="Dashboard summary">
              <article className="summary-card">
                <span>Completion</span>
                <strong>82%</strong>
                <p>Curriculum evidence and attainment records are moving steadily.</p>
              </article>
              <article className="summary-card">
                <span>Open Tasks</span>
                <strong>34</strong>
                <p>Review pending marks uploads, assessment links, and gap actions.</p>
              </article>
              <article className="summary-card">
                <span>Report Ready</span>
                <strong>9</strong>
                <p>NBA exports are prepared for department-level verification.</p>
              </article>
            </section>

            <section className="module-panel">
              <div>
                <p className="eyebrow">Current workspace</p>
                <h3>{selectedItem.label}</h3>
                <p>
                  Use this area for {selectedItem.label.toLowerCase()} forms,
                  tables, approvals, and analytics. The side menu is wired so each
                  item can become a full screen as the system grows.
                </p>
              </div>
              <div className="status-stack">
                <span>{selectedItem.metric}</span>
                <strong>Ready</strong>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  )
}

export default App
