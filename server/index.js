import express from 'express';
import pg from 'pg';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env')) {
  const lines = readFileSync('.env', 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split('=');
    process.env[key.trim()] ??= valueParts.join('=').trim();
  }
}

const app = express();
const port = process.env.PORT || 3002;
const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'obe_db',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || undefined,
});

app.use(express.json());

app.use((error, _request, response, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    response.status(400).json({
      error: 'Invalid JSON request body.',
      detail: error.message,
    });
    return;
  }

  next(error);
});

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'abit_obe-api',
  });
});

app.get('/api/faculty-management', async (_request, response) => {
  try {
    await ensureAuthTables();
    const result = await pool.query(`
      SELECT faculty.faculty_id, COALESCE(faculty.department_id, users.department_id) AS department_id, faculty.faculty_code,
        faculty.faculty_name, faculty.designation, faculty.email, faculty.status,
        faculty.login_username, faculty.user_id, department.department_code,
        department.department_name, (faculty.user_id IS NOT NULL) AS create_login
      FROM faculty
      LEFT JOIN users ON users.user_id = faculty.user_id
      LEFT JOIN department ON department.department_id = COALESCE(faculty.department_id, users.department_id)
      ORDER BY faculty.faculty_name, faculty.faculty_code
    `);
    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/faculty-management', async (request, response) => {
  await saveFacultyRecord(request, response, null);
});

app.post('/api/faculty-management/import', async (request, response) => {
  const departmentId = Number(request.body.department_id);
  const rows = Array.isArray(request.body.rows) ? request.body.rows : [];
  if (!Number.isInteger(departmentId) || !rows.length) {
    response.status(400).json({ error: 'Department and faculty rows are required.' });
    return;
  }

  const client = await pool.connect();
  try {
    await ensureAuthTables();
    await client.query('BEGIN');
    const departmentResult = await client.query(
      'SELECT department_code FROM department WHERE department_id = $1',
      [departmentId],
    );
    if (!departmentResult.rowCount) throw new Error('Selected Department was not found.');
    const departmentCode = String(departmentResult.rows[0].department_code || '').trim().toUpperCase();
    let inserted = 0;
    let updated = 0;

    for (const [index, rawRow] of rows.entries()) {
      const facultyCode = String(rawRow.faculty_code || '').trim().toUpperCase();
      const facultyName = String(rawRow.faculty_name || '').trim();
      const designation = String(rawRow.designation || '').trim();
      const rowDepartmentCode = String(rawRow.department_code || '').trim().toUpperCase();
      const loginUsername = String(rawRow.login_username || '').trim().toLowerCase();
      const email = String(rawRow.email || '').trim().toLowerCase();
      const status = rawRow.status === 'Inactive' ? 'Inactive' : 'Active';
      if (!facultyCode || !facultyName || !designation || !rowDepartmentCode || !loginUsername || !email) {
        throw new Error(`Row ${index + 2}: all template columns are required.`);
      }
      if (rowDepartmentCode !== departmentCode) {
        throw new Error(`Row ${index + 2}: Department Code must be ${departmentCode}.`);
      }
      const existing = await client.query(
        'SELECT faculty_id FROM faculty WHERE UPPER(faculty_code) = $1 OR LOWER(email) = $2 LIMIT 1',
        [facultyCode, email],
      );
      if (existing.rowCount) {
        await client.query(`
          UPDATE faculty SET department_id = $1, faculty_code = $2, faculty_name = $3,
            designation = $4, login_username = $5, email = $6, status = $7,
            updated_at = CURRENT_TIMESTAMP WHERE faculty_id = $8
        `, [departmentId, facultyCode, facultyName, designation, loginUsername, email, status, existing.rows[0].faculty_id]);
        updated += 1;
      } else {
        await client.query(`
          INSERT INTO faculty (department_id, faculty_code, faculty_name, designation,
            login_username, email, status, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        `, [departmentId, facultyCode, facultyName, designation, loginUsername, email, status]);
        inserted += 1;
      }
    }
    await client.query('COMMIT');
    response.json({ message: `${inserted} faculty imported and ${updated} faculty updated.`, inserted, updated });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({ error: 'Unable to import faculty.', detail: error.message });
  } finally {
    client.release();
  }
});

app.put('/api/faculty-management/:facultyId', async (request, response) => {
  const facultyId = Number(request.params.facultyId);
  if (!Number.isInteger(facultyId)) {
    response.status(400).json({ error: 'Valid Faculty is required.' });
    return;
  }
  await saveFacultyRecord(request, response, facultyId);
});

async function saveFacultyRecord(request, response, facultyId) {
  const departmentId = Number(request.body.department_id);
  const facultyCode = String(request.body.faculty_code || '').trim().toUpperCase();
  const facultyName = String(request.body.faculty_name || '').trim();
  const designation = String(request.body.designation || '').trim();
  const loginUsername = String(request.body.login_username || '').trim().toLowerCase();
  const email = String(request.body.email || '').trim().toLowerCase();
  const status = request.body.status === 'Inactive' ? 'Inactive' : 'Active';
  const createLogin = Boolean(request.body.create_login);
  const initialPassword = String(request.body.initial_password || '');

  if (!Number.isInteger(departmentId) || !facultyCode || !facultyName || !designation || !email) {
    response.status(400).json({ error: 'Department, Faculty Code, Faculty Name, Designation, and Email are required.' });
    return;
  }
  if (createLogin && (!loginUsername || (!facultyId && !initialPassword))) {
    response.status(400).json({ error: 'Login Username and Initial Password are required when Create Login is selected.' });
    return;
  }

  const client = await pool.connect();
  try {
    await ensureAuthTables();
    await client.query('BEGIN');
    const department = await client.query(
      'SELECT department_id FROM department WHERE department_id = $1',
      [departmentId],
    );
    if (!department.rowCount) throw new Error('Selected Department was not found.');

    const duplicate = await client.query(`
      SELECT faculty_id FROM faculty
      WHERE (UPPER(faculty_code) = $1 OR LOWER(email) = $2)
        AND ($3::integer IS NULL OR faculty_id <> $3)
      LIMIT 1
    `, [facultyCode, email, facultyId]);
    if (duplicate.rowCount) throw new Error('Faculty Code or Email already exists.');

    let userId = null;
    if (facultyId) {
      const current = await client.query('SELECT user_id FROM faculty WHERE faculty_id = $1', [facultyId]);
      if (!current.rowCount) throw new Error('Faculty record not found.');
      userId = current.rows[0].user_id;
    }

    if (createLogin) {
      const matchingUsers = await client.query(
        `SELECT user_id, role, user_type
         FROM users
         WHERE (LOWER(email) = $1 OR LOWER(COALESCE(username, '')) = $2)
           AND ($3::integer IS NULL OR user_id <> $3)
         ORDER BY user_id`,
        [email, loginUsername, userId],
      );

      if (matchingUsers.rowCount > 1) {
        throw new Error('Email and Login Username belong to different user accounts.');
      }

      if (userId && matchingUsers.rowCount) {
        throw new Error('Email or Login Username already belongs to another user account.');
      }

      if (!userId) {
        if (matchingUsers.rowCount) {
          const existingUser = matchingUsers.rows[0];
          if (existingUser.role === 'Admin' || existingUser.user_type === 'Admin') {
            throw new Error('This email or login username belongs to an Admin account and cannot be linked to faculty.');
          }
          const linkedFaculty = await client.query(
            `SELECT faculty_id FROM faculty
             WHERE user_id = $1 AND ($2::integer IS NULL OR faculty_id <> $2)
             LIMIT 1`,
            [existingUser.user_id, facultyId],
          );
          if (linkedFaculty.rowCount) {
            throw new Error('This email or login username is already linked to another faculty record.');
          }
          userId = existingUser.user_id;
        }
      }

      if (userId) {
        const values = [email, facultyName, loginUsername, status, userId, departmentId];
        if (initialPassword) values.push(hashPassword(initialPassword));
        await client.query(`
          UPDATE users SET email = $1, full_name = $2, username = $3, status = $4,
            department_id = $6, updated_at = CURRENT_TIMESTAMP${initialPassword ? ', password_hash = $7' : ''}
          WHERE user_id = $5
        `, values);
      } else {
        const userResult = await client.query(`
          INSERT INTO users (email, password_hash, full_name, username, department_id, role, user_type, status, updated_at)
          VALUES ($1, $2, $3, $4, $5, 'User', 'User', $6, CURRENT_TIMESTAMP)
          RETURNING user_id
        `, [email, hashPassword(initialPassword), facultyName, loginUsername, departmentId, status]);
        userId = userResult.rows[0].user_id;
      }
    } else {
      userId = null;
    }

    const values = [departmentId, facultyCode, facultyName, designation, loginUsername, email, status, userId];
    const result = facultyId
      ? await client.query(`
          UPDATE faculty SET department_id = $1, faculty_code = $2, faculty_name = $3,
            designation = $4, login_username = $5, email = $6, status = $7, user_id = $8,
            updated_at = CURRENT_TIMESTAMP WHERE faculty_id = $9 RETURNING faculty_id
        `, [...values, facultyId])
      : await client.query(`
          INSERT INTO faculty (department_id, faculty_code, faculty_name, designation,
            login_username, email, status, user_id, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) RETURNING faculty_id
        `, values);
    await client.query('COMMIT');
    response.status(facultyId ? 200 : 201).json({
      message: facultyId ? 'Faculty updated.' : 'Faculty saved.',
      faculty_id: result.rows[0].faculty_id,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const detail = error.code === '23505' && error.constraint === 'users_email_key'
      ? 'Email already belongs to another user account.'
      : error.message;
    response.status(400).json({ error: 'Unable to save faculty.', detail });
  } finally {
    client.release();
  }
}

app.post('/api/login', async (request, response) => {
  const { email, password } = request.body;

  if (!email || !password) {
    response.status(400).json({ error: 'Email ID and Password are required.' });
    return;
  }

  try {
    await ensureAuthTables();
    const userResult = await pool.query(
      `
        SELECT user_id, email, full_name, role, status, password_hash
        FROM users
        WHERE LOWER(email) = LOWER($1) OR LOWER(COALESCE(username, '')) = LOWER($1)
      `,
      [String(email).trim()],
    );
    const user = userResult.rows[0];

    if (!user || user.status !== 'Active' || user.password_hash !== hashPassword(password)) {
      response.status(401).json({ error: 'Invalid login details.' });
      return;
    }

    const modulesResult =
      user.role === 'Admin'
        ? await pool.query(`
            SELECT module_name
            FROM modules
            WHERE status = 'Active'
            ORDER BY module_id ASC
          `)
        : await pool.query(
            `
              SELECT modules.module_name
              FROM user_module_permissions
              JOIN modules ON modules.module_id = user_module_permissions.module_id
              WHERE user_module_permissions.user_id = $1
                AND (
                  user_module_permissions.can_access = TRUE
                  OR EXISTS (
                    SELECT 1 FROM faculty_module_permissions
                    WHERE faculty_module_permissions.user_id = user_module_permissions.user_id
                      AND faculty_module_permissions.module_id = user_module_permissions.module_id
                      AND (
                        faculty_module_permissions.can_view OR faculty_module_permissions.can_create
                        OR faculty_module_permissions.can_edit OR faculty_module_permissions.can_delete
                        OR faculty_module_permissions.can_upload OR faculty_module_permissions.can_calculate
                        OR faculty_module_permissions.can_export
                      )
                  )
                )
                AND modules.status = 'Active'
              ORDER BY modules.module_id ASC
            `,
            [user.user_id],
          );

    response.json({
      user: {
        user_id: user.user_id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      modules: modulesResult.rows.map((row) => row.module_name),
    });
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.put('/api/users/:userId/password', async (request, response) => {
  const userId = Number(request.params.userId);
  const newPassword = String(request.body.new_password || '');
  if (!Number.isInteger(userId)) {
    response.status(400).json({ error: 'Valid User ID is required.' });
    return;
  }
  if (newPassword.length < 6) {
    response.status(400).json({ error: 'New Password must contain at least 6 characters.' });
    return;
  }
  try {
    await ensureAuthTables();
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 AND status = \'Active\' RETURNING user_id',
      [hashPassword(newPassword), userId],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: 'Active user login not found.' });
      return;
    }
    response.json({ message: 'Password changed successfully.' });
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/user-modules/:userId', async (request, response) => {
  const userId = Number(request.params.userId);
  if (!Number.isInteger(userId)) {
    response.status(400).json({ error: 'Valid User ID is required.' });
    return;
  }
  try {
    await ensureAuthTables();
    const result = await pool.query(`
      SELECT modules.module_name
      FROM modules
      WHERE modules.status = 'Active'
        AND EXISTS (
          SELECT 1 FROM user_module_permissions
          WHERE user_module_permissions.user_id = $1
            AND user_module_permissions.module_id = modules.module_id
            AND user_module_permissions.can_access = TRUE
        )
        OR (
          modules.status = 'Active' AND EXISTS (
            SELECT 1 FROM faculty_module_permissions
            WHERE faculty_module_permissions.user_id = $1
              AND faculty_module_permissions.module_id = modules.module_id
              AND (
                can_view OR can_create OR can_edit OR can_delete
                OR can_upload OR can_calculate OR can_export
              )
          )
        )
      ORDER BY modules.module_id
    `, [userId]);
    response.json(result.rows.map((row) => row.module_name));
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/user-permissions/:userId', async (request, response) => {
  const userId = Number(request.params.userId);
  if (!Number.isInteger(userId)) {
    response.status(400).json({ error: 'Valid User ID is required.' });
    return;
  }
  try {
    await ensureAuthTables();
    const result = await pool.query(`
      SELECT modules.module_name,
        COALESCE(BOOL_OR(faculty_module_permissions.can_view), FALSE)
          OR COALESCE(BOOL_OR(user_module_permissions.can_access), FALSE) AS can_view,
        COALESCE(BOOL_OR(faculty_module_permissions.can_create), FALSE) AS can_create,
        COALESCE(BOOL_OR(faculty_module_permissions.can_edit), FALSE) AS can_edit,
        COALESCE(BOOL_OR(faculty_module_permissions.can_delete), FALSE) AS can_delete,
        COALESCE(BOOL_OR(faculty_module_permissions.can_upload), FALSE) AS can_upload,
        COALESCE(BOOL_OR(faculty_module_permissions.can_calculate), FALSE) AS can_calculate,
        COALESCE(BOOL_OR(faculty_module_permissions.can_export), FALSE) AS can_export
      FROM modules
      LEFT JOIN faculty_module_permissions
        ON faculty_module_permissions.module_id = modules.module_id
        AND faculty_module_permissions.user_id = $1
      LEFT JOIN user_module_permissions
        ON user_module_permissions.module_id = modules.module_id
        AND user_module_permissions.user_id = $1
      WHERE modules.status = 'Active'
      GROUP BY modules.module_id, modules.module_name
      HAVING COALESCE(BOOL_OR(faculty_module_permissions.can_view), FALSE)
        OR COALESCE(BOOL_OR(faculty_module_permissions.can_create), FALSE)
        OR COALESCE(BOOL_OR(faculty_module_permissions.can_edit), FALSE)
        OR COALESCE(BOOL_OR(faculty_module_permissions.can_delete), FALSE)
        OR COALESCE(BOOL_OR(faculty_module_permissions.can_upload), FALSE)
        OR COALESCE(BOOL_OR(faculty_module_permissions.can_calculate), FALSE)
        OR COALESCE(BOOL_OR(faculty_module_permissions.can_export), FALSE)
        OR COALESCE(BOOL_OR(user_module_permissions.can_access), FALSE)
      ORDER BY modules.module_id
    `, [userId]);
    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/faculty-login-mapping', async (_request, response) => {
  try {
    await ensureAuthTables();
    await pool.query(`
      INSERT INTO faculty (department_id, faculty_name, email, designation)
      SELECT users.department_id, users.full_name, users.email, 'Faculty'
      FROM users
      WHERE users.role <> 'Admin'
        AND NOT EXISTS (
          SELECT 1 FROM faculty WHERE LOWER(faculty.email) = LOWER(users.email)
        )
    `);
    const result = await pool.query(`
      SELECT users.user_id, faculty.faculty_id, users.full_name AS faculty_name, users.email, users.role,
        users.status, users.department_id, department.department_code, department.department_name,
        users.created_at, users.updated_at
      FROM users
      LEFT JOIN department ON department.department_id = users.department_id
      LEFT JOIN faculty ON LOWER(faculty.email) = LOWER(users.email)
      ORDER BY users.full_name ASC, users.email ASC
    `);
    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/faculty-permissions', async (request, response) => {
  const userId = Number(request.query.user_id);
  const departmentId = Number(request.query.department_id);
  const academicYear = String(request.query.academic_year || '').trim();
  if (!Number.isInteger(userId) || !Number.isInteger(departmentId) || !academicYear) {
    response.status(400).json({ error: 'Faculty, Department, and Academic Year are required.' });
    return;
  }
  try {
    await ensureAuthTables();
    const result = await pool.query(`
      SELECT modules.module_id, modules.module_name,
        COALESCE(faculty_module_permissions.can_view, FALSE) AS can_view,
        COALESCE(faculty_module_permissions.can_create, FALSE) AS can_create,
        COALESCE(faculty_module_permissions.can_edit, FALSE) AS can_edit,
        COALESCE(faculty_module_permissions.can_delete, FALSE) AS can_delete,
        COALESCE(faculty_module_permissions.can_upload, FALSE) AS can_upload,
        COALESCE(faculty_module_permissions.can_calculate, FALSE) AS can_calculate,
        COALESCE(faculty_module_permissions.can_export, FALSE) AS can_export
      FROM modules
      LEFT JOIN faculty_module_permissions
        ON faculty_module_permissions.module_id = modules.module_id
       AND faculty_module_permissions.user_id = $1
       AND faculty_module_permissions.department_id = $2
       AND faculty_module_permissions.academic_year = $3
      WHERE modules.status = 'Active'
      ORDER BY
        CASE modules.module_name
          WHEN 'Dashboard' THEN 1
          WHEN 'Departments' THEN 2
          WHEN 'Department Vision and Mission' THEN 3
          ELSE 4
        END,
        modules.module_id
    `, [userId, departmentId, academicYear]);
    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/faculty-permissions', async (request, response) => {
  const userId = Number(request.body.user_id);
  const departmentId = Number(request.body.department_id);
  const academicYear = String(request.body.academic_year || '').trim();
  const rows = Array.isArray(request.body.permissions) ? request.body.permissions : [];
  if (!Number.isInteger(userId) || !Number.isInteger(departmentId) || !academicYear || !rows.length) {
    response.status(400).json({ error: 'Faculty, Department, Academic Year, and permissions are required.' });
    return;
  }
  const client = await pool.connect();
  try {
    await ensureAuthTables();
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO faculty_department_mapping (user_id, department_id, academic_year, status, updated_at)
      VALUES ($1, $2, $3, 'Active', CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, department_id, academic_year)
      DO UPDATE SET status = 'Active', updated_at = CURRENT_TIMESTAMP
    `, [userId, departmentId, academicYear]);
    for (const row of rows) {
      const moduleId = Number(row.module_id);
      if (!Number.isInteger(moduleId)) continue;
      const flags = ['can_view', 'can_create', 'can_edit', 'can_delete', 'can_upload', 'can_calculate', 'can_export']
        .map((key) => Boolean(row[key]));
      flags[0] = flags.some(Boolean);
      await client.query(`
        INSERT INTO faculty_module_permissions (
          user_id, department_id, module_id, academic_year, can_view, can_create, can_edit,
          can_delete, can_upload, can_calculate, can_export, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, department_id, module_id, academic_year) DO UPDATE SET
          can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
          can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete,
          can_upload = EXCLUDED.can_upload, can_calculate = EXCLUDED.can_calculate,
          can_export = EXCLUDED.can_export, updated_at = CURRENT_TIMESTAMP
      `, [userId, departmentId, moduleId, academicYear, ...flags]);
      await client.query(`
        INSERT INTO user_module_permissions (user_id, module_id, can_access)
        SELECT $1, $2, EXISTS (
          SELECT 1 FROM faculty_module_permissions
          WHERE user_id = $1 AND module_id = $2 AND can_view = TRUE
        )
        ON CONFLICT (user_id, module_id) DO UPDATE SET can_access = EXCLUDED.can_access
      `, [userId, moduleId]);
    }
    await client.query('COMMIT');
    response.json({ message: 'Faculty permissions saved.' });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({ error: 'Unable to save faculty permissions.', detail: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/faculty-course-assignments', async (request, response) => {
  const facultyId = Number(request.query.faculty_id);
  const programmeId = Number(request.query.programme_id);
  const semesterId = Number(request.query.semester_id);
  const academicYear = String(request.query.academic_year || '2025-26').trim();
  if (![facultyId, programmeId, semesterId].every(Number.isInteger)) {
    response.status(400).json({ error: 'Faculty, Programme, and Semester are required.' });
    return;
  }
  try {
    await ensureAuthTables();
    const result = await pool.query(`
      SELECT courses.course_id, courses.course_code, courses.course_name,
        department.department_code, department.department_name,
        programmes.programme_name, semesters.semester_name,
        COALESCE(faculty_course_assignments.section, 'A') AS section,
        (faculty_course_assignments.assignment_id IS NOT NULL) AS selected,
        COALESCE(faculty_course_assignments.is_course_coordinator, FALSE) AS is_coordinator
      FROM courses
      LEFT JOIN department ON department.department_id = courses.department_id
      LEFT JOIN programmes ON programmes.programme_id = courses.programme_id
      LEFT JOIN semesters ON semesters.semester_id = courses.semester_id
      LEFT JOIN faculty_course_assignments
        ON faculty_course_assignments.course_id = courses.course_id
       AND faculty_course_assignments.faculty_id = $1
       AND faculty_course_assignments.academic_year = $4
      WHERE courses.programme_id = $2 AND courses.semester_id = $3
      ORDER BY courses.course_code, courses.course_name
    `, [facultyId, programmeId, semesterId, academicYear]);
    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/branch-wise-report-options', async (request, response) => {
  const userId = Number(request.query.user_id);
  if (!Number.isInteger(userId)) {
    response.status(400).json({ error: 'Logged-in faculty is required.' });
    return;
  }
  try {
    await ensureAuthTables();
    const departmentResult = await pool.query(`
      SELECT department.department_id, department.department_code, department.department_name
      FROM department
      WHERE department.department_id = COALESCE(
        (
          SELECT faculty_department_mapping.department_id
          FROM faculty_department_mapping
          WHERE faculty_department_mapping.user_id = $1
            AND faculty_department_mapping.status = 'Active'
          ORDER BY faculty_department_mapping.updated_at DESC
          LIMIT 1
        ),
        (SELECT users.department_id FROM users WHERE users.user_id = $1),
        (
          SELECT faculty.department_id
          FROM faculty
          WHERE faculty.user_id = $1
             OR LOWER(faculty.email) = (SELECT LOWER(users.email) FROM users WHERE users.user_id = $1)
          ORDER BY faculty.faculty_id
          LIMIT 1
        )
      )
    `, [userId]);
    const department = departmentResult.rows[0] || null;
    if (!department) {
      response.json({ department: null, courses: [] });
      return;
    }
    const courseResult = await pool.query(`
      SELECT DISTINCT courses.course_id, courses.department_id, department.department_code,
        department.department_name, courses.programme_id, programmes.programme_code,
        programmes.programme_name, courses.semester_id, semesters.semester_name,
        courses.course_code, courses.course_name, courses.status
      FROM faculty
      JOIN faculty_course_assignments
        ON faculty_course_assignments.faculty_id = faculty.faculty_id
       AND faculty_course_assignments.status = 'Active'
      JOIN courses ON courses.course_id = faculty_course_assignments.course_id
      LEFT JOIN department ON department.department_id = courses.department_id
      LEFT JOIN programmes ON programmes.programme_id = courses.programme_id
      LEFT JOIN semesters ON semesters.semester_id = courses.semester_id
      WHERE (faculty.user_id = $1
         OR LOWER(faculty.email) = (SELECT LOWER(users.email) FROM users WHERE users.user_id = $1))
        AND courses.department_id = $2
        AND courses.status <> 'Inactive'
      ORDER BY courses.course_code, courses.course_name
    `, [userId, department.department_id]);
    response.json({ department, courses: courseResult.rows });
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/faculty-course-assignments', async (request, response) => {
  const userId = Number(request.body.user_id);
  const facultyId = Number(request.body.faculty_id);
  const programmeId = Number(request.body.programme_id);
  const semesterId = Number(request.body.semester_id);
  const academicYear = String(request.body.academic_year || '2025-26').trim();
  const rows = Array.isArray(request.body.assignments) ? request.body.assignments : [];
  if (![userId, facultyId, programmeId, semesterId].every(Number.isInteger)) {
    response.status(400).json({ error: 'Faculty, Programme, and Semester are required.' });
    return;
  }
  const client = await pool.connect();
  try {
    await ensureAuthTables();
    await client.query('BEGIN');
    await client.query(`
      DELETE FROM faculty_course_assignments
      WHERE faculty_id = $1 AND academic_year = $2 AND course_id IN (
        SELECT course_id FROM courses WHERE programme_id = $3 AND semester_id = $4
      )
    `, [facultyId, academicYear, programmeId, semesterId]);
    for (const row of rows) {
      const courseId = Number(row.course_id);
      if (!Number.isInteger(courseId)) continue;
      await client.query(`
        INSERT INTO faculty_course_assignments (
          faculty_id, course_id, academic_year, section, is_course_coordinator, assigned_by, status, assigned_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'Active', CURRENT_TIMESTAMP)
      `, [facultyId, courseId, academicYear, String(row.section || 'A').trim() || 'A', Boolean(row.is_coordinator), userId]);
    }
    await client.query('COMMIT');
    response.json({ message: 'Faculty course mapping and permissions saved.' });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({ error: 'Unable to save faculty course assignments.', detail: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/faculty-login-mapping', async (request, response) => {
  const facultyName = String(request.body.faculty_name || '').trim();
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  const role = request.body.role === 'Admin' ? 'Admin' : 'User';
  const status = request.body.status === 'Inactive' ? 'Inactive' : 'Active';

  if (!facultyName || !email || !password) {
    response.status(400).json({ error: 'Faculty Name, Email, and Password are required.' });
    return;
  }

  try {
    await ensureAuthTables();
    const result = await pool.query(`
      INSERT INTO users (full_name, email, password_hash, role, user_type, status, updated_at)
      VALUES ($1, $2, $3, $4, $4, $5, CURRENT_TIMESTAMP)
      RETURNING user_id, full_name AS faculty_name, email, role, status
    `, [facultyName, email, hashPassword(password), role, status]);
    response.status(201).json({ message: 'Faculty login mapping created.', row: result.rows[0] });
  } catch (error) {
    response.status(400).json({ error: 'Unable to create faculty login mapping.', detail: error.message });
  }
});

app.put('/api/faculty-login-mapping/:userId', async (request, response) => {
  const userId = Number(request.params.userId);
  const facultyName = String(request.body.faculty_name || '').trim();
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  const role = request.body.role === 'Admin' ? 'Admin' : 'User';
  const status = request.body.status === 'Inactive' ? 'Inactive' : 'Active';

  if (!Number.isInteger(userId) || !facultyName || !email) {
    response.status(400).json({ error: 'Valid Faculty, Faculty Name, and Email are required.' });
    return;
  }

  try {
    await ensureAuthTables();
    const values = [facultyName, email, role, status, userId];
    const passwordUpdate = password ? `, password_hash = $6` : '';
    if (password) values.push(hashPassword(password));
    const result = await pool.query(`
      UPDATE users SET full_name = $1, email = $2, role = $3, user_type = $3, status = $4,
        updated_at = CURRENT_TIMESTAMP${passwordUpdate}
      WHERE user_id = $5
      RETURNING user_id, full_name AS faculty_name, email, role, status
    `, values);
    if (!result.rowCount) {
      response.status(404).json({ error: 'Faculty login mapping not found.' });
      return;
    }
    response.json({ message: 'Faculty login mapping updated.', row: result.rows[0] });
  } catch (error) {
    response.status(400).json({ error: 'Unable to update faculty login mapping.', detail: error.message });
  }
});

function sendDatabaseError(response, error) {
  console.error(error);
  const setupHint =
    'Check PostgreSQL is running and set PGHOST, PGPORT, PGDATABASE=obe_db, PGUSER, and PGPASSWORD before starting npm run server.';

  response.status(500).json({
    error: 'Database request failed',
    detail: error.message,
    setupHint,
  });
}

function assertDatabaseConfig() {
  if (!process.env.PGPASSWORD) {
    throw new Error('PGPASSWORD is missing. Add it to .env or set it before running npm run server.');
  }
}

function normalizeOutcomeCode(type, value) {
  const prefix = type === 'PSO' ? 'PSO' : type === 'PEO' ? 'PEO' : 'PO';
  const code = String(value || '').trim().toUpperCase().replace(/\s+/g, '');

  if (!code) {
    return '';
  }

  if (/^\d+$/.test(code)) {
    return `${prefix}${code}`;
  }

  return code.startsWith(prefix) ? code : `${prefix}${code.replace(/^(PSO|PEO|PO)/, '')}`;
}

function normalizeCourseOutcomeCode(value) {
  const code = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const match = code.match(/CO-?(\d+)$/);

  return match ? `CO${match[1]}` : code.replace(/[^A-Z0-9]/g, '');
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password || '')).digest('hex');
}

const defaultModules = [
  'Dashboard',
  'Departments',
  'Department Vision and Mission',
  'Programmes',
  'Admission Batch Management',
  'Semester',
  'Courses',
  'Set Target',
  'Course Outcomes',
  'PO/PSO/PEO',
  'CO-PO Mapping',
  'University Mapping Question',
  'External Mark Upload',
  'Internal Mark Upload',
  'Attainment',
  'Articulation Matrix',
  'Mark Attainment',
  'CO Attainment Calculation',
  'CO-PO Attainment',
  'CO-PSO Attainment',
  'Faculty',
  'Add Faculty',
  'Import Faculty',
  'Students',
  'Import Student',
  'Student Course Faculty Mapping',
  'Report',
  'All Departments',
  'Department Wise',
  'Course Wise',
  'Settings',
  'Faculty Login Mapping',
  'Faculty Permission Management',
  'Assigned Courses',
];

function modulePath(moduleName) {
  return `/${String(moduleName || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\s*\/\s*/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')}`;
}

function parentModule(moduleName) {
  if ([
    'Add Faculty',
    'Import Faculty',
  ].includes(moduleName)) {
    return 'Faculty';
  }

  if ([
    'Import Student',
    'Student Course Faculty Mapping',
  ].includes(moduleName)) {
    return 'Students';
  }

  if ([
    'All Departments',
    'Department Wise',
    'Course Wise',
  ].includes(moduleName)) {
    return 'Report';
  }

  if ([
    'Articulation Matrix',
    'Mark Attainment',
    'CO Attainment Calculation',
    'CO-PO Attainment',
    'CO-PSO Attainment',
  ].includes(moduleName)) {
    return 'Attainment';
  }

  return [
    'Faculty Login Mapping',
    'Faculty Permission Management',
    'Assigned Courses',
  ].includes(moduleName)
    ? 'Settings'
    : '';
}

async function ensureAuthTables() {
  assertDatabaseConfig();
  await ensureDepartmentTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id SERIAL PRIMARY KEY,
      email VARCHAR(180) UNIQUE NOT NULL,
      password_hash VARCHAR(128) NOT NULL,
      full_name VARCHAR(180) DEFAULT '',
      role VARCHAR(20) NOT NULL CHECK (role IN ('Admin', 'User')),
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS password_hash VARCHAR(128),
      ADD COLUMN IF NOT EXISTS full_name VARCHAR(180) DEFAULT '',
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'User',
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS username VARCHAR(120),
      ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES department(department_id),
      ADD COLUMN IF NOT EXISTS user_type VARCHAR(20) DEFAULT 'User'
  `);

  await pool.query(`
    DO $$
    DECLARE
      constraint_name text;
    BEGIN
      FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND contype = 'f'
          AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (department_id)%'
          AND pg_get_constraintdef(oid) NOT ILIKE '%REFERENCES department(department_id)%'
      LOOP
        EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', constraint_name);
      END LOOP;
    END $$;
  `);

  await pool.query(`
    UPDATE users
    SET department_id = NULL
    WHERE department_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM department WHERE department.department_id = users.department_id
      )
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND contype = 'f'
          AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (department_id)%'
          AND pg_get_constraintdef(oid) ILIKE '%REFERENCES department(department_id)%'
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT users_department_id_fkey
          FOREIGN KEY (department_id)
          REFERENCES department(department_id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE users ALTER COLUMN user_type SET DEFAULT 'User'
  `);

  await pool.query(`
    UPDATE users
    SET user_type = COALESCE(NULLIF(user_type, ''), role, 'User')
    WHERE user_type IS NULL OR user_type = ''
  `);

  await pool.query(`
    ALTER TABLE faculty
      ADD COLUMN IF NOT EXISTS faculty_code VARCHAR(80),
      ADD COLUMN IF NOT EXISTS login_username VARCHAR(120),
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(user_id),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    DO $$
    DECLARE
      constraint_name text;
    BEGIN
      FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'faculty'::regclass
          AND contype = 'f'
          AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (department_id)%'
          AND pg_get_constraintdef(oid) NOT ILIKE '%REFERENCES department(department_id)%'
      LOOP
        EXECUTE format('ALTER TABLE faculty DROP CONSTRAINT %I', constraint_name);
      END LOOP;
    END $$;
  `);

  await pool.query(`
    UPDATE faculty
    SET department_id = NULL
    WHERE department_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM department WHERE department.department_id = faculty.department_id
      )
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'faculty'::regclass
          AND contype = 'f'
          AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (department_id)%'
          AND pg_get_constraintdef(oid) ILIKE '%REFERENCES department(department_id)%'
      ) THEN
        ALTER TABLE faculty
          ADD CONSTRAINT faculty_department_id_fkey
          FOREIGN KEY (department_id)
          REFERENCES department(department_id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS modules (
      module_id SERIAL PRIMARY KEY,
      module_name VARCHAR(120) UNIQUE NOT NULL,
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    UPDATE modules AS current_module
    SET module_name = renamed_module.new_name
    FROM (VALUES
      ('All Branches', 'All Departments'),
      ('Branch Wise', 'Department Wise'),
      ('Subject Wise', 'Course Wise')
    ) AS renamed_module(old_name, new_name)
    WHERE current_module.module_name = renamed_module.old_name
      AND NOT EXISTS (
        SELECT 1 FROM modules AS existing_module
        WHERE existing_module.module_name = renamed_module.new_name
      )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_module_permissions (
      permission_id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
      module_id INTEGER REFERENCES modules(module_id) ON DELETE CASCADE,
      can_access BOOLEAN DEFAULT TRUE,
      UNIQUE (user_id, module_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS faculty_department_mapping (
      faculty_department_id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
      department_id INTEGER REFERENCES department(department_id) ON DELETE CASCADE,
      academic_year VARCHAR(20) NOT NULL,
      status VARCHAR(20) DEFAULT 'Active',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, department_id, academic_year)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS faculty_course_assignments (
      assignment_id SERIAL PRIMARY KEY,
      faculty_id INTEGER NOT NULL REFERENCES faculty(faculty_id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
      academic_year VARCHAR(20) NOT NULL,
      section VARCHAR(20) DEFAULT 'A',
      is_course_coordinator BOOLEAN DEFAULT FALSE,
      assigned_by INTEGER REFERENCES users(user_id),
      assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(20) DEFAULT 'Active',
      UNIQUE (faculty_id, course_id, academic_year, section)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS faculty_module_permissions (
      faculty_permission_id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
      department_id INTEGER REFERENCES department(department_id) ON DELETE CASCADE,
      module_id INTEGER REFERENCES modules(module_id) ON DELETE CASCADE,
      academic_year VARCHAR(20) NOT NULL,
      can_view BOOLEAN DEFAULT FALSE,
      can_create BOOLEAN DEFAULT FALSE,
      can_edit BOOLEAN DEFAULT FALSE,
      can_delete BOOLEAN DEFAULT FALSE,
      can_upload BOOLEAN DEFAULT FALSE,
      can_calculate BOOLEAN DEFAULT FALSE,
      can_export BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, department_id, module_id, academic_year)
    )
  `);

  await pool.query(`ALTER TABLE faculty_module_permissions ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES department(department_id) ON DELETE CASCADE`);
  await pool.query(`ALTER TABLE faculty_module_permissions DROP CONSTRAINT IF EXISTS faculty_module_permissions_user_id_module_id_academic_year_key`);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'faculty_module_permissions_user_department_module_year_key'
      ) THEN
        ALTER TABLE faculty_module_permissions ADD CONSTRAINT faculty_module_permissions_user_department_module_year_key
          UNIQUE (user_id, department_id, module_id, academic_year);
      END IF;
    END $$
  `);

  await pool.query(`
    UPDATE modules
    SET module_name = 'PO/PSO/PEO'
    WHERE module_name = 'PO / PSO'
      AND NOT EXISTS (
        SELECT 1 FROM modules AS renamed_module
        WHERE renamed_module.module_name = 'PO/PSO/PEO'
      )
  `);
  await pool.query(`
    UPDATE modules
    SET module_name = 'Department Vision and Mission'
    WHERE module_name IN ('Vision and Mission', 'Department Vision & Mission')
      AND NOT EXISTS (
        SELECT 1 FROM modules AS current_module
        WHERE current_module.module_name = 'Department Vision and Mission'
      )
  `);

  const moduleColumnsResult = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'modules'
  `);
  const moduleColumns = new Set(moduleColumnsResult.rows.map((row) => row.column_name));

  for (const [index, moduleName] of defaultModules.entries()) {
    const insertColumns = ['module_name'];
    const selectValues = ['$1::varchar'];
    const values = [moduleName];

    if (moduleColumns.has('module_path')) {
      values.push(modulePath(moduleName));
      insertColumns.push('module_path');
      selectValues.push(`$${values.length}::varchar`);
    }

    if (moduleColumns.has('parent_module')) {
      values.push(parentModule(moduleName));
      insertColumns.push('parent_module');
      selectValues.push(`$${values.length}::varchar`);
    }

    if (moduleColumns.has('module_icon')) {
      values.push('');
      insertColumns.push('module_icon');
      selectValues.push(`$${values.length}::varchar`);
    }

    if (moduleColumns.has('icon')) {
      values.push('');
      insertColumns.push('icon');
      selectValues.push(`$${values.length}::varchar`);
    }

    if (moduleColumns.has('display_order')) {
      values.push(index + 1);
      insertColumns.push('display_order');
      selectValues.push(`$${values.length}::integer`);
    }

    if (moduleColumns.has('status')) {
      values.push('Active');
      insertColumns.push('status');
      selectValues.push(`$${values.length}::varchar`);
    }

    await pool.query(
      `
        INSERT INTO modules (${insertColumns.join(', ')})
        SELECT ${selectValues.join(', ')}
        WHERE NOT EXISTS (
          SELECT 1 FROM modules WHERE module_name = $1::varchar
        )
      `,
      values,
    );

    const updateAssignments = [];
    const updateValues = [];

    if (moduleColumns.has('module_path')) {
      updateValues.push(modulePath(moduleName));
      updateAssignments.push(`module_path = $${updateValues.length}::varchar`);
    }

    if (moduleColumns.has('parent_module')) {
      updateValues.push(parentModule(moduleName));
      updateAssignments.push(`parent_module = $${updateValues.length}::varchar`);
    }

    if (moduleColumns.has('display_order')) {
      updateValues.push(index + 1);
      updateAssignments.push(`display_order = $${updateValues.length}::integer`);
    }

    if (moduleColumns.has('status')) {
      updateValues.push('Active');
      updateAssignments.push(`status = $${updateValues.length}::varchar`);
    }

    if (updateAssignments.length) {
      updateValues.push(moduleName);
      await pool.query(
        `
          UPDATE modules
          SET ${updateAssignments.join(', ')}
          WHERE module_name = $${updateValues.length}::varchar
        `,
        updateValues,
      );
    }
  }

  const userColumnsResult = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'users'
  `);
  const userColumns = new Set(userColumnsResult.rows.map((row) => row.column_name));
  const userInsertColumns = [];
  const userSelectValues = [];
  const userValues = [];
  const addUserValue = (column, value, cast = 'varchar') => {
    if (!userColumns.has(column)) {
      return;
    }

    userValues.push(value);
    userInsertColumns.push(column);
    userSelectValues.push(`$${userValues.length}::${cast}`);
  };

  addUserValue('email', 'admin@abit.edu.in');
  addUserValue('username', 'admin');
  addUserValue('password_hash', hashPassword('admin123'));
  addUserValue('password', 'admin123');
  addUserValue('full_name', 'ABIT Admin');
  addUserValue('name', 'ABIT Admin');
  addUserValue('role', 'Admin');
  addUserValue('user_type', 'Admin');
  addUserValue('status', 'Active');

  await pool.query(
    `
      INSERT INTO users (${userInsertColumns.join(', ')})
      SELECT ${userSelectValues.join(', ')}
      WHERE NOT EXISTS (
        SELECT 1 FROM users WHERE LOWER(email) = LOWER($1::varchar)
      )
    `,
    userValues,
  );
}

async function ensureDepartmentTable() {
  assertDatabaseConfig();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS department (
      department_id SERIAL PRIMARY KEY,
      department_code VARCHAR(20) NOT NULL,
      department_name VARCHAR(150) NOT NULL,
      institute_college VARCHAR(150) DEFAULT '',
      hod VARCHAR(150) DEFAULT '',
      email VARCHAR(150) DEFAULT '',
      phone VARCHAR(40) DEFAULT '',
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE department
      ADD COLUMN IF NOT EXISTS institute_college VARCHAR(150) DEFAULT '',
      ADD COLUMN IF NOT EXISTS hod VARCHAR(150) DEFAULT '',
      ADD COLUMN IF NOT EXISTS email VARCHAR(150) DEFAULT '',
      ADD COLUMN IF NOT EXISTS phone VARCHAR(40) DEFAULT '',
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
}

async function ensureProgrammesTable() {
  await ensureDepartmentTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programmes (
      programme_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_code VARCHAR(40) NOT NULL,
      programme_name VARCHAR(180) NOT NULL,
      programme_type VARCHAR(30) DEFAULT 'UG',
      duration_years INTEGER DEFAULT 4,
      total_semesters INTEGER DEFAULT 8,
      accreditation_status VARCHAR(40) DEFAULT 'Accredited',
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    DO $$
    DECLARE
      constraint_name text;
    BEGIN
      FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'programmes'::regclass
          AND contype = 'f'
          AND pg_get_constraintdef(oid) NOT ILIKE '%REFERENCES department(department_id)%'
      LOOP
        EXECUTE format('ALTER TABLE programmes DROP CONSTRAINT %I', constraint_name);
      END LOOP;
    END $$;
  `);

  await pool.query(`
    ALTER TABLE programmes
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_type VARCHAR(30) DEFAULT 'UG',
      ADD COLUMN IF NOT EXISTS duration_years INTEGER DEFAULT 4,
      ADD COLUMN IF NOT EXISTS total_semesters INTEGER DEFAULT 8,
      ADD COLUMN IF NOT EXISTS accreditation_status VARCHAR(40) DEFAULT 'Accredited',
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'programmes'::regclass
          AND conname = 'programmes_department_id_fkey'
      ) THEN
        ALTER TABLE programmes
          ADD CONSTRAINT programmes_department_id_fkey
          FOREIGN KEY (department_id)
          REFERENCES department(department_id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);
}

async function ensureSemestersTable() {
  await ensureProgrammesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS semesters (
      semester_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE CASCADE,
      semester_number INTEGER NOT NULL,
      semester_name VARCHAR(80) NOT NULL,
      academic_year VARCHAR(20) DEFAULT '',
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE semesters
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_no INTEGER,
      ADD COLUMN IF NOT EXISTS semester_number INTEGER,
      ADD COLUMN IF NOT EXISTS semester_name VARCHAR(80) DEFAULT '',
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20) DEFAULT '',
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'semesters'::regclass
          AND conname = 'semesters_department_id_fkey'
      ) THEN
        ALTER TABLE semesters
          ADD CONSTRAINT semesters_department_id_fkey
          FOREIGN KEY (department_id)
          REFERENCES department(department_id)
          ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'semesters'::regclass
          AND conname = 'semesters_programme_id_fkey'
      ) THEN
        ALTER TABLE semesters
          ADD CONSTRAINT semesters_programme_id_fkey
          FOREIGN KEY (programme_id)
          REFERENCES programmes(programme_id)
          ON DELETE CASCADE;
      END IF;
    END $$;
  `);
}

async function ensureAdmissionBatchesTable() {
  await ensureSemestersTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_years (
      academic_year_id SERIAL PRIMARY KEY,
      academic_year VARCHAR(20) NOT NULL,
      start_date DATE,
      end_date DATE,
      status VARCHAR(20) DEFAULT 'Active'
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admission_batches (
      admission_batch_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER NOT NULL REFERENCES programmes(programme_id) ON DELETE CASCADE,
      start_academic_year_id INTEGER NOT NULL REFERENCES academic_years(academic_year_id),
      duration_years INTEGER NOT NULL,
      total_semesters INTEGER NOT NULL,
      starting_academic_year VARCHAR(20) NOT NULL,
      admission_year INTEGER NOT NULL,
      completion_year INTEGER NOT NULL,
      batch_code VARCHAR(30) NOT NULL,
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (programme_id, admission_year)
    )
  `);

  await pool.query(`
    ALTER TABLE admission_batches
      ADD COLUMN IF NOT EXISTS admission_batch_id SERIAL,
      ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS start_academic_year_id INTEGER REFERENCES academic_years(academic_year_id),
      ADD COLUMN IF NOT EXISTS duration_years INTEGER DEFAULT 4,
      ADD COLUMN IF NOT EXISTS total_semesters INTEGER DEFAULT 8,
      ADD COLUMN IF NOT EXISTS starting_academic_year VARCHAR(20) DEFAULT '',
      ADD COLUMN IF NOT EXISTS admission_year INTEGER,
      ADD COLUMN IF NOT EXISTS completion_year INTEGER,
      ADD COLUMN IF NOT EXISTS batch_code VARCHAR(30) DEFAULT '',
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS admission_batches_generated_id_key
    ON admission_batches (admission_batch_id)
  `);

  await pool.query(`
    ALTER TABLE semesters
      ADD COLUMN IF NOT EXISTS admission_batch_id INTEGER REFERENCES admission_batches(admission_batch_id) ON DELETE CASCADE
  `);
}

async function ensureCoursesTable() {
  await ensureSemestersTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS courses (
      course_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE SET NULL,
      semester_id INTEGER REFERENCES semesters(semester_id) ON DELETE SET NULL,
      course_code VARCHAR(40) NOT NULL,
      course_name VARCHAR(180) NOT NULL,
      course_type VARCHAR(30) DEFAULT 'Theory',
      credits INTEGER DEFAULT 4,
      lecture_hours INTEGER DEFAULT 3,
      tutorial_hours INTEGER DEFAULT 1,
      practical_hours INTEGER DEFAULT 0,
      total_marks INTEGER DEFAULT 100,
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE courses
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_id INTEGER,
      ADD COLUMN IF NOT EXISTS course_code VARCHAR(40),
      ADD COLUMN IF NOT EXISTS course_name VARCHAR(180),
      ADD COLUMN IF NOT EXISTS course_type VARCHAR(30) DEFAULT 'Theory',
      ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 4,
      ADD COLUMN IF NOT EXISTS lecture_hours INTEGER DEFAULT 3,
      ADD COLUMN IF NOT EXISTS tutorial_hours INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS practical_hours INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_marks INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'courses'::regclass
          AND conname = 'courses_department_id_fkey'
      ) THEN
        ALTER TABLE courses
          ADD CONSTRAINT courses_department_id_fkey
          FOREIGN KEY (department_id)
          REFERENCES department(department_id)
          ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'courses'::regclass
          AND conname = 'courses_programme_id_fkey'
      ) THEN
        ALTER TABLE courses
          ADD CONSTRAINT courses_programme_id_fkey
          FOREIGN KEY (programme_id)
          REFERENCES programmes(programme_id)
          ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'courses'::regclass
          AND conname = 'courses_semester_id_fkey'
      ) THEN
        ALTER TABLE courses
          ADD CONSTRAINT courses_semester_id_fkey
          FOREIGN KEY (semester_id)
          REFERENCES semesters(semester_id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);
}

async function ensureAssessmentAttainmentLevelsTable() {
  assertDatabaseConfig();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS assessment_attainment_levels (
      level_id SERIAL PRIMARY KEY,
      academic_year VARCHAR(20) NOT NULL,
      assessment_category VARCHAR(120) NOT NULL,
      level_number INTEGER NOT NULL,
      code VARCHAR(10) NOT NULL,
      level_name VARCHAR(80) NOT NULL,
      min_percentage NUMERIC(6, 2) NOT NULL,
      max_percentage NUMERIC(6, 2) NOT NULL,
      condition_text VARCHAR(180) DEFAULT '',
      remarks TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (academic_year, assessment_category, level_number)
    )
  `);

  await pool.query(`
    ALTER TABLE assessment_attainment_levels
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20),
      ADD COLUMN IF NOT EXISTS assessment_category VARCHAR(120),
      ADD COLUMN IF NOT EXISTS level_no INTEGER,
      ADD COLUMN IF NOT EXISTS level_number INTEGER,
      ADD COLUMN IF NOT EXISTS code VARCHAR(10),
      ADD COLUMN IF NOT EXISTS level_name VARCHAR(80),
      ADD COLUMN IF NOT EXISTS min_percentage NUMERIC(6, 2),
      ADD COLUMN IF NOT EXISTS max_percentage NUMERIC(6, 2),
      ADD COLUMN IF NOT EXISTS condition_text VARCHAR(180) DEFAULT '',
      ADD COLUMN IF NOT EXISTS remarks TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
}

async function ensureBloomLevelTable() {
  assertDatabaseConfig();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bloom_level (
      bloom_id SERIAL PRIMARY KEY,
      bloom_code VARCHAR(20) NOT NULL,
      bloom_level VARCHAR(80) NOT NULL,
      learning_outcome_verbs TEXT NOT NULL
    )
  `);

  await pool.query(`
    ALTER TABLE bloom_level
      ADD COLUMN IF NOT EXISTS bloom_id INTEGER,
      ADD COLUMN IF NOT EXISTS bloom_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS bloom_level VARCHAR(80),
      ADD COLUMN IF NOT EXISTS learning_outcome_verbs TEXT
  `);

  await pool.query('CREATE SEQUENCE IF NOT EXISTS bloom_level_bloom_id_seq');
  await pool.query(`
    SELECT setval(
      'bloom_level_bloom_id_seq',
      COALESCE((SELECT MAX(bloom_id) FROM bloom_level), 0) + 1,
      false
    )
  `);
  await pool.query(`
    ALTER TABLE bloom_level
      ALTER COLUMN bloom_id SET DEFAULT nextval('bloom_level_bloom_id_seq')
  `);
  await pool.query(`
    UPDATE bloom_level
    SET bloom_id = nextval('bloom_level_bloom_id_seq')
    WHERE bloom_id IS NULL
  `);
  await pool.query(`
    UPDATE bloom_level
    SET bloom_code = regexp_replace(bloom_code, '^B([1-6])$', 'L\\1')
    WHERE bloom_code ~ '^B[1-6]$'
  `);

  const result = await pool.query('SELECT COUNT(*)::int AS count FROM bloom_level');

  if (result.rows[0]?.count > 0) {
    return;
  }

  await pool.query(
    `
      INSERT INTO bloom_level (bloom_code, bloom_level, learning_outcome_verbs)
      VALUES
        ('L1', 'Remember', 'define, list, recall, recognize, identify, state, name, label'),
        ('L2', 'Understand', 'understand, explain, describe, discuss, classify, summarize, interpret'),
        ('L3', 'Apply', 'apply, solve, use, demonstrate, calculate, implement, execute'),
        ('L4', 'Analyze', 'analyze, compare, differentiate, examine, test, categorize'),
        ('L5', 'Evaluate', 'evaluate, justify, assess, critique, validate, judge'),
        ('L6', 'Create', 'create, design, develop, formulate, construct, compose')
    `,
  );
}

function getFirstOutcomeVerb(statement) {
  return String(statement || '').trim().match(/[A-Za-z0-9]+/)?.[0]?.toLowerCase() || '';
}

async function getFallbackBloomMatch(fallbackBloomLevel = 'Understand') {
  const fallbackResult = await pool.query(
    `
      SELECT bloom_id, bloom_code, bloom_level
      FROM bloom_level
      WHERE bloom_id IS NOT NULL
      ORDER BY
        CASE WHEN lower(COALESCE(bloom_level, '')) = lower($1) THEN 0 ELSE 1 END,
        bloom_code ASC
      LIMIT 1
    `,
    [fallbackBloomLevel || 'Understand'],
  );

  if (fallbackResult.rows.length) {
    return {
      bloomId: fallbackResult.rows[0].bloom_id ?? null,
      bloomCode: fallbackResult.rows[0].bloom_code || '',
      bloomLevel: fallbackResult.rows[0].bloom_level || fallbackBloomLevel || 'Understand',
    };
  }

  const insertedResult = await pool.query(
    `
      INSERT INTO bloom_level (bloom_code, bloom_level, learning_outcome_verbs)
      VALUES ('L2', 'Understand', 'understand, explain, describe, discuss, classify, summarize, interpret')
      RETURNING bloom_id, bloom_code, bloom_level
    `,
  );

  return {
    bloomId: insertedResult.rows[0].bloom_id ?? null,
    bloomCode: insertedResult.rows[0].bloom_code || 'L2',
    bloomLevel: insertedResult.rows[0].bloom_level || 'Understand',
  };
}

async function findBloomLevelForStatement(statement, fallbackBloomLevel = 'Understand') {
  await ensureBloomLevelTable();

  const firstVerb = getFirstOutcomeVerb(statement);

  if (!firstVerb) {
    return getFallbackBloomMatch(fallbackBloomLevel);
  }

  const result = await pool.query(
    `
      SELECT bloom_id, bloom_code, bloom_level
      FROM bloom_level
      WHERE EXISTS (
        SELECT 1
        FROM regexp_split_to_table(lower(COALESCE(learning_outcome_verbs, '')), '[^a-z0-9]+') AS verb
        WHERE verb = $1
      )
      ORDER BY bloom_code ASC
      LIMIT 1
    `,
    [firstVerb],
  );

  if (!result.rows.length) {
    return getFallbackBloomMatch(fallbackBloomLevel);
  }

  return {
    bloomId: result.rows[0].bloom_id ?? null,
    bloomCode: result.rows[0].bloom_code || '',
    bloomLevel: result.rows[0].bloom_level || fallbackBloomLevel || 'Understand',
  };
}

async function ensureCourseOutcomesTable() {
  await ensureCoursesTable();
  await ensureBloomLevelTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_outcomes (
      co_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE SET NULL,
      semester_id INTEGER REFERENCES semesters(semester_id) ON DELETE SET NULL,
      course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
      co_code VARCHAR(20) NOT NULL,
      co_statement TEXT NOT NULL,
      bloom_id INTEGER,
      bloom_level VARCHAR(40) DEFAULT 'Understand',
      bloom_code VARCHAR(20) DEFAULT '',
      target_level NUMERIC(5, 2) DEFAULT 2.50,
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE course_outcomes
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_id INTEGER,
      ADD COLUMN IF NOT EXISTS course_id INTEGER,
      ADD COLUMN IF NOT EXISTS co_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS co_statement TEXT,
      ADD COLUMN IF NOT EXISTS bloom_id INTEGER,
      ADD COLUMN IF NOT EXISTS bloom_level VARCHAR(40) DEFAULT 'Understand',
      ADD COLUMN IF NOT EXISTS bloom_code VARCHAR(20) DEFAULT '',
      ADD COLUMN IF NOT EXISTS target_level NUMERIC(5, 2) DEFAULT 2.50,
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
  await pool.query(`
    UPDATE course_outcomes
    SET bloom_code = regexp_replace(bloom_code, '^B([1-6])$', 'L\\1')
    WHERE bloom_code ~ '^B[1-6]$'
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'course_outcomes'::regclass
          AND conname = 'course_outcomes_department_id_fkey'
      ) THEN
        ALTER TABLE course_outcomes
          ADD CONSTRAINT course_outcomes_department_id_fkey
          FOREIGN KEY (department_id)
          REFERENCES department(department_id)
          ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'course_outcomes'::regclass
          AND conname = 'course_outcomes_programme_id_fkey'
      ) THEN
        ALTER TABLE course_outcomes
          ADD CONSTRAINT course_outcomes_programme_id_fkey
          FOREIGN KEY (programme_id)
          REFERENCES programmes(programme_id)
          ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'course_outcomes'::regclass
          AND conname = 'course_outcomes_semester_id_fkey'
      ) THEN
        ALTER TABLE course_outcomes
          ADD CONSTRAINT course_outcomes_semester_id_fkey
          FOREIGN KEY (semester_id)
          REFERENCES semesters(semester_id)
          ON DELETE SET NULL;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'course_outcomes'::regclass
          AND conname = 'course_outcomes_course_id_fkey'
          AND confdeltype <> 'c'
      ) THEN
        ALTER TABLE course_outcomes
          DROP CONSTRAINT course_outcomes_course_id_fkey;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'course_outcomes'::regclass
          AND conname = 'course_outcomes_course_id_fkey'
      ) THEN
        ALTER TABLE course_outcomes
          ADD CONSTRAINT course_outcomes_course_id_fkey
          FOREIGN KEY (course_id)
          REFERENCES courses(course_id)
          ON DELETE CASCADE;
      END IF;
    END $$;
  `);
}

async function ensureProgrammeOutcomesTable() {
  await ensureProgrammesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS programme_outcomes (
      outcome_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE CASCADE,
      outcome_type VARCHAR(10) NOT NULL,
      outcome_code VARCHAR(20) NOT NULL,
      po_code VARCHAR(20) DEFAULT '',
      pso_code VARCHAR(20) DEFAULT '',
      po_title VARCHAR(180) DEFAULT '',
      pso_title VARCHAR(180) DEFAULT '',
      po_statement TEXT DEFAULT '',
      pso_statement TEXT DEFAULT '',
      outcome_title VARCHAR(180) NOT NULL,
      outcome_statement TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE programme_outcomes
      ADD COLUMN IF NOT EXISTS outcome_id SERIAL,
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS outcome_type VARCHAR(10),
      ADD COLUMN IF NOT EXISTS outcome_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS po_code VARCHAR(20) DEFAULT '',
      ADD COLUMN IF NOT EXISTS pso_code VARCHAR(20) DEFAULT '',
      ADD COLUMN IF NOT EXISTS po_title VARCHAR(180) DEFAULT '',
      ADD COLUMN IF NOT EXISTS pso_title VARCHAR(180) DEFAULT '',
      ADD COLUMN IF NOT EXISTS po_statement TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS pso_statement TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS outcome_title VARCHAR(180),
      ADD COLUMN IF NOT EXISTS outcome_statement TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE programme_outcomes
      ALTER COLUMN po_code SET DEFAULT '',
      ALTER COLUMN pso_code SET DEFAULT '',
      ALTER COLUMN po_title SET DEFAULT '',
      ALTER COLUMN pso_title SET DEFAULT '',
      ALTER COLUMN po_statement SET DEFAULT '',
      ALTER COLUMN pso_statement SET DEFAULT '',
      ALTER COLUMN po_code DROP NOT NULL,
      ALTER COLUMN pso_code DROP NOT NULL,
      ALTER COLUMN po_title DROP NOT NULL,
      ALTER COLUMN pso_title DROP NOT NULL,
      ALTER COLUMN po_statement DROP NOT NULL,
      ALTER COLUMN pso_statement DROP NOT NULL
  `);

  await pool.query(`
    UPDATE programme_outcomes
    SET outcome_code = COALESCE(NULLIF(outcome_code, ''), NULLIF(po_code, ''), NULLIF(pso_code, ''))
    WHERE outcome_code IS NULL
      OR outcome_code = ''
  `);

  await pool.query(`
    UPDATE programme_outcomes
    SET po_code = COALESCE(NULLIF(po_code, ''), NULLIF(outcome_code, ''), NULLIF(pso_code, ''), 'PO')
    WHERE po_code IS NULL
      OR po_code = ''
  `);

  await pool.query(`
    UPDATE programme_outcomes
    SET pso_code = COALESCE(NULLIF(pso_code, ''), NULLIF(outcome_code, ''), NULLIF(po_code, ''), 'PSO')
    WHERE pso_code IS NULL
      OR pso_code = ''
  `);

  await pool.query(`
    UPDATE programme_outcomes
    SET outcome_title = COALESCE(NULLIF(outcome_title, ''), NULLIF(po_title, ''), NULLIF(pso_title, ''), 'Untitled Outcome')
    WHERE outcome_title IS NULL
      OR outcome_title = ''
  `);

  await pool.query(`
    UPDATE programme_outcomes
    SET outcome_statement = COALESCE(NULLIF(outcome_statement, ''), NULLIF(po_statement, ''), NULLIF(pso_statement, ''), 'Outcome statement pending')
    WHERE outcome_statement IS NULL
      OR outcome_statement = ''
  `);

  await pool.query(`
    UPDATE programme_outcomes
    SET
      po_title = COALESCE(NULLIF(po_title, ''), NULLIF(outcome_title, ''), 'Untitled Outcome'),
      pso_title = COALESCE(NULLIF(pso_title, ''), NULLIF(outcome_title, ''), 'Untitled Outcome'),
      po_statement = COALESCE(NULLIF(po_statement, ''), NULLIF(outcome_statement, ''), 'Outcome statement pending'),
      pso_statement = COALESCE(NULLIF(pso_statement, ''), NULLIF(outcome_statement, ''), 'Outcome statement pending')
    WHERE po_title IS NULL
      OR po_title = ''
      OR pso_title IS NULL
      OR pso_title = ''
      OR po_statement IS NULL
      OR po_statement = ''
      OR pso_statement IS NULL
      OR pso_statement = ''
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'programme_outcomes'::regclass
          AND conname = 'programme_outcomes_department_id_fkey'
      ) THEN
        ALTER TABLE programme_outcomes
          ADD CONSTRAINT programme_outcomes_department_id_fkey
          FOREIGN KEY (department_id)
          REFERENCES department(department_id)
          ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'programme_outcomes'::regclass
          AND conname = 'programme_outcomes_programme_id_fkey'
      ) THEN
        ALTER TABLE programme_outcomes
          ADD CONSTRAINT programme_outcomes_programme_id_fkey
          FOREIGN KEY (programme_id)
          REFERENCES programmes(programme_id)
          ON DELETE CASCADE;
      END IF;
    END $$;
  `);
}

async function ensureDashboardContentTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_content (
      dashboard_content_id SERIAL PRIMARY KEY,
      content_type VARCHAR(30) UNIQUE NOT NULL,
      content_label VARCHAR(80) NOT NULL,
      content_statement TEXT DEFAULT '',
      icon VARCHAR(20) DEFAULT '',
      theme_color VARCHAR(20) DEFAULT '#374151',
      status VARCHAR(20) DEFAULT 'Active',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE dashboard_content
      ADD COLUMN IF NOT EXISTS content_type VARCHAR(30),
      ADD COLUMN IF NOT EXISTS content_label VARCHAR(80),
      ADD COLUMN IF NOT EXISTS content_statement TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS icon VARCHAR(20) DEFAULT '',
      ADD COLUMN IF NOT EXISTS theme_color VARCHAR(20) DEFAULT '#374151',
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    INSERT INTO dashboard_content (content_type, content_label, icon, theme_color, status)
    VALUES
      ('VISION', 'VISION', '◉', '#f97300', 'Active'),
      ('MISSION', 'MISSION', '◎', '#343a43', 'Active')
    ON CONFLICT (content_type) DO NOTHING
  `);
}

async function ensureDepartmentVisionMissionTable() {
  await ensureDepartmentTable();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS department_vision_mission (
      department_vision_mission_id SERIAL PRIMARY KEY,
      department_id INTEGER NOT NULL REFERENCES department(department_id) ON DELETE CASCADE,
      content_type VARCHAR(20) NOT NULL,
      content_title VARCHAR(120) NOT NULL,
      content_statement TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'Active',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (department_id, content_type)
    )
  `);

  // Upgrade older installations where CREATE TABLE IF NOT EXISTS does not add
  // the columns and conflict key required by the Vision/Mission upload upsert.
  await pool.query(`
    ALTER TABLE department_vision_mission
      ADD COLUMN IF NOT EXISTS department_vision_mission_id SERIAL,
      ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES department(department_id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS content_type VARCHAR(20),
      ADD COLUMN IF NOT EXISTS content_title VARCHAR(120),
      ADD COLUMN IF NOT EXISTS content_statement TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
  await pool.query(`
    UPDATE department_vision_mission
    SET content_type = UPPER(TRIM(content_type)),
        content_title = COALESCE(NULLIF(TRIM(content_title), ''), UPPER(TRIM(content_type))),
        status = COALESCE(NULLIF(TRIM(status), ''), 'Active'),
        updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
  `);
  await pool.query(`
    WITH duplicate_rows AS (
      SELECT ctid, ROW_NUMBER() OVER (
        PARTITION BY department_id, content_type
        ORDER BY updated_at DESC NULLS LAST, department_vision_mission_id DESC NULLS LAST, ctid DESC
      ) AS row_number
      FROM department_vision_mission
      WHERE department_id IS NOT NULL AND content_type IS NOT NULL
    )
    DELETE FROM department_vision_mission
    USING duplicate_rows
    WHERE department_vision_mission.ctid = duplicate_rows.ctid
      AND duplicate_rows.row_number > 1
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS department_vision_mission_department_type_key
    ON department_vision_mission (department_id, content_type)
  `);
}

async function ensureCoPoMappingTable() {
  await ensureCourseOutcomesTable();
  await ensureProgrammeOutcomesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS co_po_mapping (
      mapping_id SERIAL PRIMARY KEY,
      co_id INTEGER NOT NULL REFERENCES course_outcomes(co_id) ON DELETE CASCADE,
      po_id INTEGER NOT NULL REFERENCES programme_outcomes(po_id) ON DELETE CASCADE,
      mapping_level INTEGER NOT NULL CHECK (mapping_level BETWEEN 0 AND 3),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (co_id, po_id)
    )
  `);
}

async function ensureArticulationMatrixTable() {
  await ensureCourseOutcomesTable();
  await ensureProgrammeOutcomesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS articulation_matrix (
      articulation_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE SET NULL,
      semester_id INTEGER REFERENCES semesters(semester_id) ON DELETE SET NULL,
      course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
      co_id INTEGER REFERENCES course_outcomes(co_id) ON DELETE SET NULL,
      outcome_id INTEGER REFERENCES programme_outcomes(outcome_id) ON DELETE SET NULL,
      component_id INTEGER NOT NULL DEFAULT 1,
      academic_year VARCHAR(20) NOT NULL DEFAULT '2024-25',
      department_name VARCHAR(150) NOT NULL,
      programme_name VARCHAR(180) NOT NULL,
      semester_name VARCHAR(80) NOT NULL,
      course_code VARCHAR(40) NOT NULL,
      course_name VARCHAR(180) NOT NULL,
      co_code VARCHAR(20) NOT NULL,
      co_statement TEXT DEFAULT '',
      outcome_type VARCHAR(10) NOT NULL CHECK (outcome_type IN ('PO', 'PSO')),
      outcome_code VARCHAR(20) NOT NULL,
      outcome_title VARCHAR(180) DEFAULT '',
      articulation_level INTEGER NOT NULL CHECK (articulation_level BETWEEN 0 AND 3),
      attend INTEGER DEFAULT 0 CHECK (attend BETWEEN 0 AND 3),
      a1 INTEGER DEFAULT 0 CHECK (a1 BETWEEN 0 AND 3),
      a2 INTEGER DEFAULT 0 CHECK (a2 BETWEEN 0 AND 3),
      qt1 INTEGER DEFAULT 0 CHECK (qt1 BETWEEN 0 AND 3),
      qt2 INTEGER DEFAULT 0 CHECK (qt2 BETWEEN 0 AND 3),
      st1 INTEGER DEFAULT 0 CHECK (st1 BETWEEN 0 AND 3),
      st2 INTEGER DEFAULT 0 CHECK (st2 BETWEEN 0 AND 3),
      ct1 INTEGER DEFAULT 0 CHECK (ct1 BETWEEN 0 AND 3),
      ct2 INTEGER DEFAULT 0 CHECK (ct2 BETWEEN 0 AND 3),
      end_sem INTEGER DEFAULT 0 CHECK (end_sem BETWEEN 0 AND 3),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (course_id, co_code, outcome_type, outcome_code)
    )
  `);

  await pool.query(`
    ALTER TABLE articulation_matrix
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_id INTEGER,
      ADD COLUMN IF NOT EXISTS course_id INTEGER,
      ADD COLUMN IF NOT EXISTS co_id INTEGER,
      ADD COLUMN IF NOT EXISTS outcome_id INTEGER,
      ADD COLUMN IF NOT EXISTS component_id INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20) DEFAULT '2024-25',
      ADD COLUMN IF NOT EXISTS department_name VARCHAR(150),
      ADD COLUMN IF NOT EXISTS programme_name VARCHAR(180),
      ADD COLUMN IF NOT EXISTS semester_name VARCHAR(80),
      ADD COLUMN IF NOT EXISTS course_code VARCHAR(40),
      ADD COLUMN IF NOT EXISTS course_name VARCHAR(180),
      ADD COLUMN IF NOT EXISTS co_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS co_statement TEXT DEFAULT '',
      ADD COLUMN IF NOT EXISTS outcome_type VARCHAR(10),
      ADD COLUMN IF NOT EXISTS outcome_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS outcome_title VARCHAR(180) DEFAULT '',
      ADD COLUMN IF NOT EXISTS articulation_level INTEGER,
      ADD COLUMN IF NOT EXISTS attend INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS a1 INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS a2 INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS qt1 INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS qt2 INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS st1 INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS st2 INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ct1 INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ct2 INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS end_sem INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    UPDATE articulation_matrix
    SET component_id = 1
    WHERE component_id IS NULL
  `);

  await pool.query(`
    ALTER TABLE articulation_matrix
      ALTER COLUMN component_id SET DEFAULT 1
  `);

  await pool.query(`
    UPDATE articulation_matrix
    SET academic_year = '2024-25'
    WHERE academic_year IS NULL
  `);

  await pool.query(`
    ALTER TABLE articulation_matrix
      ALTER COLUMN academic_year SET DEFAULT '2024-25'
  `);
}

async function getOrCreateArticulationComponentId(client, courseId, academicYear) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS internal_assessment_components (
      component_id SERIAL PRIMARY KEY,
      course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
      component_code VARCHAR(40) NOT NULL,
      component_name VARCHAR(120) NOT NULL,
      max_marks NUMERIC(7, 2) NOT NULL,
      display_order INTEGER DEFAULT 1,
      academic_year VARCHAR(20) NOT NULL,
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const existing = await client.query(
    `
      SELECT component_id
      FROM internal_assessment_components
      WHERE course_id = $1
        AND academic_year = $2
        AND component_code = 'ARTICULATION_MATRIX'
      ORDER BY component_id ASC
      LIMIT 1
    `,
    [courseId, academicYear],
  );

  if (existing.rows[0]) {
    return existing.rows[0].component_id;
  }

  const inserted = await client.query(
    `
      INSERT INTO internal_assessment_components (
        course_id,
        component_code,
        component_name,
        max_marks,
        display_order,
        academic_year,
        status
      )
      VALUES ($1, 'ARTICULATION_MATRIX', 'Articulation Matrix', 3, 1, $2, 'Active')
      RETURNING component_id
    `,
    [courseId, academicYear],
  );

  return inserted.rows[0].component_id;
}

async function ensureExternalMarksUploadTable() {
  await ensureCoursesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS external_marks_upload (
      mark_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE SET NULL,
      semester_id INTEGER REFERENCES semesters(semester_id) ON DELETE SET NULL,
      course_id INTEGER REFERENCES courses(course_id) ON DELETE SET NULL,
      academic_year VARCHAR(20) NOT NULL,
      sl_no INTEGER,
      regd_no VARCHAR(60) NOT NULL,
      student_name VARCHAR(180) NOT NULL,
      sgpa NUMERIC(6, 2),
      grade VARCHAR(20) DEFAULT '',
      course_code VARCHAR(40) DEFAULT '',
      course_name VARCHAR(180) DEFAULT '',
      percent_mark NUMERIC(7, 2) NOT NULL,
      average_mark NUMERIC(7, 2) NOT NULL,
      target_average NUMERIC(7, 2) NOT NULL,
      attainment_value NUMERIC(10, 5) NOT NULL,
      calculation_summary JSONB DEFAULT '{}'::jsonb,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE external_marks_upload
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_id INTEGER,
      ADD COLUMN IF NOT EXISTS course_id INTEGER,
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20) DEFAULT '2024-25',
      ADD COLUMN IF NOT EXISTS sl_no INTEGER,
      ADD COLUMN IF NOT EXISTS regd_no VARCHAR(60),
      ADD COLUMN IF NOT EXISTS student_name VARCHAR(180),
      ADD COLUMN IF NOT EXISTS sgpa NUMERIC(6, 2),
      ADD COLUMN IF NOT EXISTS grade VARCHAR(20) DEFAULT '',
      ADD COLUMN IF NOT EXISTS course_code VARCHAR(40) DEFAULT '',
      ADD COLUMN IF NOT EXISTS course_name VARCHAR(180) DEFAULT '',
      ADD COLUMN IF NOT EXISTS percent_mark NUMERIC(7, 2),
      ADD COLUMN IF NOT EXISTS average_mark NUMERIC(7, 2),
      ADD COLUMN IF NOT EXISTS target_average NUMERIC(7, 2),
      ADD COLUMN IF NOT EXISTS attainment_value NUMERIC(10, 5),
      ADD COLUMN IF NOT EXISTS calculation_summary JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
}

async function ensureInternalMarksUploadTable() {
  await ensureCoursesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS internal_marks_upload (
      internal_mark_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE SET NULL,
      semester_id INTEGER REFERENCES semesters(semester_id) ON DELETE SET NULL,
      course_id INTEGER REFERENCES courses(course_id) ON DELETE SET NULL,
      academic_year VARCHAR(20) NOT NULL,
      branch VARCHAR(40) DEFAULT '',
      sl_no INTEGER,
      regd_no VARCHAR(60) NOT NULL,
      student_name VARCHAR(180) NOT NULL,
      attd NUMERIC(7, 2) DEFAULT 0,
      a1 NUMERIC(7, 2) DEFAULT 0,
      a2 NUMERIC(7, 2) DEFAULT 0,
      qt1 NUMERIC(7, 2) DEFAULT 0,
      qt2 NUMERIC(7, 2) DEFAULT 0,
      st1 NUMERIC(7, 2) DEFAULT 0,
      st2 NUMERIC(7, 2) DEFAULT 0,
      ct1 NUMERIC(7, 2) DEFAULT 0,
      ct2 NUMERIC(7, 2) DEFAULT 0,
      internal_mark NUMERIC(7, 2) NOT NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE internal_marks_upload
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_id INTEGER,
      ADD COLUMN IF NOT EXISTS course_id INTEGER,
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20) DEFAULT '2023-24',
      ADD COLUMN IF NOT EXISTS branch VARCHAR(40) DEFAULT '',
      ADD COLUMN IF NOT EXISTS sl_no INTEGER,
      ADD COLUMN IF NOT EXISTS regd_no VARCHAR(60),
      ADD COLUMN IF NOT EXISTS student_name VARCHAR(180),
      ADD COLUMN IF NOT EXISTS attd NUMERIC(7, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS a1 NUMERIC(7, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS a2 NUMERIC(7, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS qt1 NUMERIC(7, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS qt2 NUMERIC(7, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS st1 NUMERIC(7, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS st2 NUMERIC(7, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ct1 NUMERIC(7, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ct2 NUMERIC(7, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS internal_mark NUMERIC(7, 2),
      ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
}

async function ensureMarkAttainmentTable() {
  await ensureCoursesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mark_attainment (
      mark_attainment_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE SET NULL,
      semester_id INTEGER REFERENCES semesters(semester_id) ON DELETE SET NULL,
      course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
      academic_year VARCHAR(20) NOT NULL,
      assessment_tool VARCHAR(40) NOT NULL,
      tool_label VARCHAR(80) NOT NULL,
      weightage NUMERIC(8, 2) NOT NULL DEFAULT 0,
      target_average NUMERIC(10, 2) NOT NULL DEFAULT 0,
      attainment_percent NUMERIC(10, 2) NOT NULL DEFAULT 0,
      level VARCHAR(10) NOT NULL DEFAULT '',
      level_point INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (course_id, academic_year, assessment_tool)
    )
  `);

  await pool.query(`
    ALTER TABLE mark_attainment
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_id INTEGER,
      ADD COLUMN IF NOT EXISTS course_id INTEGER,
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20),
      ADD COLUMN IF NOT EXISTS assessment_tool VARCHAR(40),
      ADD COLUMN IF NOT EXISTS tool_label VARCHAR(80),
      ADD COLUMN IF NOT EXISTS weightage NUMERIC(8, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS target_average NUMERIC(10, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS attainment_percent NUMERIC(10, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS level VARCHAR(10) DEFAULT '',
      ADD COLUMN IF NOT EXISTS level_point INTEGER,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
}

async function ensureCoAttainmentCalculationTable() {
  await ensureCoursesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS co_attainment_calculation (
      calculation_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE SET NULL,
      semester_id INTEGER REFERENCES semesters(semester_id) ON DELETE SET NULL,
      course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
      academic_year VARCHAR(20) NOT NULL,
      batch VARCHAR(40) NOT NULL,
      internal_weight NUMERIC(6, 2) NOT NULL DEFAULT 80,
      external_weight NUMERIC(6, 2) NOT NULL DEFAULT 20,
      row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (course_id, academic_year, batch)
    )
  `);

  await pool.query(`
    ALTER TABLE co_attainment_calculation
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_id INTEGER,
      ADD COLUMN IF NOT EXISTS course_id INTEGER,
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20),
      ADD COLUMN IF NOT EXISTS batch VARCHAR(40),
      ADD COLUMN IF NOT EXISTS internal_weight NUMERIC(6, 2) DEFAULT 80,
      ADD COLUMN IF NOT EXISTS external_weight NUMERIC(6, 2) DEFAULT 20,
      ADD COLUMN IF NOT EXISTS row_data JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
}

async function ensureCoPoAttainmentTable() {
  await ensureCoursesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS co_po_attainment (
      co_po_attainment_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE SET NULL,
      semester_id INTEGER REFERENCES semesters(semester_id) ON DELETE SET NULL,
      course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
      academic_year VARCHAR(20) NOT NULL,
      row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (course_id, academic_year)
    )
  `);

  await pool.query(`
    ALTER TABLE co_po_attainment
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_id INTEGER,
      ADD COLUMN IF NOT EXISTS course_id INTEGER,
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20),
      ADD COLUMN IF NOT EXISTS row_data JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
}

async function ensureCoPsoAttainmentTable() {
  await ensureCoursesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS co_pso_attainment (
      co_pso_attainment_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE SET NULL,
      semester_id INTEGER REFERENCES semesters(semester_id) ON DELETE SET NULL,
      course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
      academic_year VARCHAR(20) NOT NULL,
      row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (course_id, academic_year)
    )
  `);

  await pool.query(`
    ALTER TABLE co_pso_attainment
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_id INTEGER,
      ADD COLUMN IF NOT EXISTS course_id INTEGER,
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20),
      ADD COLUMN IF NOT EXISTS row_data JSONB DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
}

async function ensureUniversityQuestionMappingTable() {
  await ensureCoursesTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS university_question_mapping (
      question_mapping_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE SET NULL,
      semester_id INTEGER REFERENCES semesters(semester_id) ON DELETE SET NULL,
      course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
      academic_year VARCHAR(20) NOT NULL,
      exam_type VARCHAR(40) NOT NULL,
      exam_month VARCHAR(40) NOT NULL,
      exam_year INTEGER NOT NULL,
      total_marks NUMERIC(7, 2) NOT NULL,
      question_no VARCHAR(20) NOT NULL,
      sub_question VARCHAR(20) NOT NULL,
      co_code VARCHAR(20) NOT NULL,
      carrying_mark NUMERIC(7, 2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE university_question_mapping
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_id INTEGER,
      ADD COLUMN IF NOT EXISTS course_id INTEGER,
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20),
      ADD COLUMN IF NOT EXISTS exam_type VARCHAR(40),
      ADD COLUMN IF NOT EXISTS exam_month VARCHAR(40),
      ADD COLUMN IF NOT EXISTS exam_year INTEGER,
      ADD COLUMN IF NOT EXISTS total_marks NUMERIC(7, 2),
      ADD COLUMN IF NOT EXISTS question_no VARCHAR(20),
      ADD COLUMN IF NOT EXISTS sub_question VARCHAR(20),
      ADD COLUMN IF NOT EXISTS co_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS carrying_mark NUMERIC(7, 2),
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
}

async function ensureStudentsTable() {
  await ensureSemestersTable();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      student_id SERIAL PRIMARY KEY,
      department_id INTEGER REFERENCES department(department_id) ON DELETE SET NULL,
      programme_id INTEGER REFERENCES programmes(programme_id) ON DELETE SET NULL,
      semester_id INTEGER REFERENCES semesters(semester_id) ON DELETE SET NULL,
      section VARCHAR(20) NOT NULL,
      batch VARCHAR(20) NOT NULL,
      academic_year VARCHAR(20) NOT NULL,
      regd_no VARCHAR(60) NOT NULL,
      registration_no VARCHAR(60) NOT NULL,
      university_regd VARCHAR(60) DEFAULT '',
      roll_number VARCHAR(60) DEFAULT '',
      student_name VARCHAR(180) NOT NULL,
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE students
      ADD COLUMN IF NOT EXISTS department_id INTEGER,
      ADD COLUMN IF NOT EXISTS programme_id INTEGER,
      ADD COLUMN IF NOT EXISTS semester_id INTEGER,
      ADD COLUMN IF NOT EXISTS section VARCHAR(20) DEFAULT 'A',
      ADD COLUMN IF NOT EXISTS batch VARCHAR(20) DEFAULT '',
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20) DEFAULT '',
      ADD COLUMN IF NOT EXISTS regd_no VARCHAR(60),
      ADD COLUMN IF NOT EXISTS registration_no VARCHAR(60),
      ADD COLUMN IF NOT EXISTS university_regd VARCHAR(60) DEFAULT '',
      ADD COLUMN IF NOT EXISTS roll_number VARCHAR(60) DEFAULT '',
      ADD COLUMN IF NOT EXISTS student_name VARCHAR(180),
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
}

async function ensureStudentCourseEnrollmentsTable() {
  await ensureStudentsTable();
  await ensureAuthTables();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_course_enrollments (
      enrollment_id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
      faculty_id INTEGER NOT NULL REFERENCES faculty(faculty_id) ON DELETE CASCADE,
      academic_year VARCHAR(20) NOT NULL,
      section VARCHAR(20) NOT NULL DEFAULT 'A',
      status VARCHAR(20) DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (student_id, course_id, academic_year, section)
    )
  `);

  await pool.query(`
    ALTER TABLE student_course_enrollments
      ADD COLUMN IF NOT EXISTS student_id INTEGER REFERENCES students(student_id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS faculty_id INTEGER REFERENCES faculty(faculty_id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS academic_year VARCHAR(20) DEFAULT '',
      ADD COLUMN IF NOT EXISTS section VARCHAR(20) DEFAULT 'A',
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'student_course_enrollments'
          AND column_name = 'course_offering_id'
      ) THEN
        ALTER TABLE student_course_enrollments
          ALTER COLUMN course_offering_id DROP NOT NULL;
      END IF;
    END $$
  `);
}

app.get('/api/departments', async (_request, response) => {
  try {
    await ensureDepartmentTable();
    const result = await pool.query(`
      SELECT
        department_id,
        department_code,
        department_name,
        institute_college,
        hod,
        email,
        phone,
        status
      FROM department
      ORDER BY department_id ASC
    `);

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/departments', async (request, response) => {
  const {
    department_name: departmentName,
    department_code: departmentCode,
    institute_college: instituteCollege = '',
    hod = '',
    email = '',
    phone = '',
    status = 'Active',
  } = request.body;

  if (!departmentName?.trim() || !departmentCode?.trim()) {
    response.status(400).json({
      error: 'Department Name and Department Code are required.',
    });
    return;
  }

  try {
    await ensureDepartmentTable();
    const result = await pool.query(
      `
        INSERT INTO department (
          department_code,
          department_name,
          institute_college,
          hod,
          email,
          phone,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        departmentCode.trim().toUpperCase(),
        departmentName.trim(),
        instituteCollege.trim(),
        hod.trim(),
        email.trim(),
        phone.trim(),
        status,
      ],
    );

    response.status(201).json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.put('/api/departments/:departmentId', async (request, response) => {
  const { departmentId } = request.params;
  const {
    department_name: departmentName,
    department_code: departmentCode,
    institute_college: instituteCollege = '',
    hod = '',
    email = '',
    phone = '',
    status = 'Active',
  } = request.body;

  if (!departmentName?.trim() || !departmentCode?.trim()) {
    response.status(400).json({
      error: 'Department Name and Department Code are required.',
    });
    return;
  }

  try {
    await ensureDepartmentTable();
    const result = await pool.query(
      `
        UPDATE department
        SET
          department_code = $1,
          department_name = $2,
          institute_college = $3,
          hod = $4,
          email = $5,
          phone = $6,
          status = $7
        WHERE department_id = $8
        RETURNING *
      `,
      [
        departmentCode.trim().toUpperCase(),
        departmentName.trim(),
        instituteCollege.trim(),
        hod.trim(),
        email.trim(),
        phone.trim(),
        status,
        departmentId,
      ],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Department not found.' });
      return;
    }

    response.json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.delete('/api/departments/:departmentId', async (request, response) => {
  try {
    await ensureDepartmentTable();
    const result = await pool.query(
      'DELETE FROM department WHERE department_id = $1 RETURNING department_id',
      [request.params.departmentId],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Department not found.' });
      return;
    }

    response.status(204).send();
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/programmes', async (_request, response) => {
  try {
    await ensureProgrammesTable();
    const result = await pool.query(`
      SELECT
        programmes.programme_id,
        programmes.department_id,
        department.department_code,
        department.department_name,
        programmes.programme_code,
        programmes.programme_name,
        programmes.programme_type,
        programmes.duration_years,
        programmes.total_semesters,
        programmes.accreditation_status,
        programmes.status
      FROM programmes
      LEFT JOIN department ON department.department_id = programmes.department_id
      ORDER BY programmes.programme_id ASC
    `);

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/programmes', async (request, response) => {
  const {
    department_id: departmentId,
    programme_code: programmeCode,
    programme_name: programmeName,
    programme_type: programmeType = 'UG',
    duration_years: durationYears = 4,
    total_semesters: totalSemesters = 8,
    accreditation_status: accreditationStatus = 'Accredited',
    status = 'Active',
  } = request.body;

  if (!departmentId || !programmeCode?.trim() || !programmeName?.trim()) {
    response.status(400).json({
      error: 'Department, Programme Code, and Programme Name are required.',
    });
    return;
  }

  try {
    await ensureProgrammesTable();
    const result = await pool.query(
      `
        INSERT INTO programmes (
          department_id,
          programme_code,
          programme_name,
          programme_type,
          duration_years,
          total_semesters,
          accreditation_status,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        departmentId,
        programmeCode.trim().toUpperCase(),
        programmeName.trim(),
        programmeType,
        Number(durationYears),
        Number(totalSemesters),
        accreditationStatus,
        status,
      ],
    );

    response.status(201).json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.put('/api/programmes/:programmeId', async (request, response) => {
  const { programmeId } = request.params;
  const {
    department_id: departmentId,
    programme_code: programmeCode,
    programme_name: programmeName,
    programme_type: programmeType = 'UG',
    duration_years: durationYears = 4,
    total_semesters: totalSemesters = 8,
    accreditation_status: accreditationStatus = 'Accredited',
    status = 'Active',
  } = request.body;

  if (!departmentId || !programmeCode?.trim() || !programmeName?.trim()) {
    response.status(400).json({
      error: 'Department, Programme Code, and Programme Name are required.',
    });
    return;
  }

  try {
    await ensureProgrammesTable();
    const result = await pool.query(
      `
        UPDATE programmes
        SET
          department_id = $1,
          programme_code = $2,
          programme_name = $3,
          programme_type = $4,
          duration_years = $5,
          total_semesters = $6,
          accreditation_status = $7,
          status = $8
        WHERE programme_id = $9
        RETURNING *
      `,
      [
        departmentId,
        programmeCode.trim().toUpperCase(),
        programmeName.trim(),
        programmeType,
        Number(durationYears),
        Number(totalSemesters),
        accreditationStatus,
        status,
        programmeId,
      ],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Programme not found.' });
      return;
    }

    response.json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.delete('/api/programmes/:programmeId', async (request, response) => {
  try {
    await ensureProgrammesTable();
    const result = await pool.query(
      'DELETE FROM programmes WHERE programme_id = $1 RETURNING programme_id',
      [request.params.programmeId],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Programme not found.' });
      return;
    }

    response.status(204).send();
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/admission-batches', async (_request, response) => {
  try {
    await ensureAdmissionBatchesTable();
    const result = await pool.query(`
      SELECT admission_batches.*, department.department_name,
        programmes.programme_code, programmes.programme_name,
        COALESCE((
          SELECT json_agg(json_build_object(
            'semester_number', generated_semesters.semester_number,
            'semester_name', generated_semesters.semester_name,
            'academic_year', generated_semesters.academic_year
          ) ORDER BY generated_semesters.semester_number)
          FROM (
            SELECT COALESCE(semesters.semester_number, semesters.semester_no) AS semester_number,
              semesters.semester_name, semesters.academic_year
            FROM semesters
            WHERE semesters.admission_batch_id = admission_batches.admission_batch_id
          ) generated_semesters
        ), '[]'::json) AS generated_semesters
      FROM admission_batches
      LEFT JOIN department ON department.department_id = admission_batches.department_id
      LEFT JOIN programmes ON programmes.programme_id = admission_batches.programme_id
      ORDER BY admission_batches.admission_year DESC, admission_batches.admission_batch_id DESC
    `);
    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/admission-batches', async (request, response) => {
  const rawAdmissionBatchId = request.body.admission_batch_id;
  const admissionBatchId = rawAdmissionBatchId === null || rawAdmissionBatchId === undefined || rawAdmissionBatchId === ''
    ? null
    : Number(rawAdmissionBatchId);
  const departmentId = Number(request.body.department_id);
  const programmeId = Number(request.body.programme_id);
  const startingAcademicYear = String(request.body.starting_academic_year || '').trim();
  const admissionYear = Number(request.body.admission_year);
  const status = request.body.status === 'Inactive' ? 'Inactive' : 'Active';

  if (!Number.isInteger(departmentId) || !Number.isInteger(programmeId) || !/^\d{4}-\d{2}$/.test(startingAcademicYear) || !Number.isInteger(admissionYear)) {
    response.status(400).json({ error: 'Department, Programme, Starting Academic Year, and Admission Year are required.' });
    return;
  }

  const client = await pool.connect();
  try {
    await ensureAdmissionBatchesTable();
    await client.query('BEGIN');
    const programmeResult = await client.query(
      `SELECT duration_years, total_semesters FROM programmes
       WHERE programme_id = $1 AND department_id = $2`,
      [programmeId, departmentId],
    );
    if (!programmeResult.rowCount) throw new Error('Selected Programme does not belong to the selected Department.');
    const durationYears = Number(programmeResult.rows[0].duration_years || 4);
    const totalSemesters = Number(programmeResult.rows[0].total_semesters || durationYears * 2);
    const completionYear = admissionYear + durationYears;
    const batchCode = `${admissionYear}-${String(completionYear).slice(-2)}`;
    let academicYearResult = await client.query(
      'SELECT academic_year_id FROM academic_years WHERE academic_year = $1 ORDER BY academic_year_id LIMIT 1',
      [startingAcademicYear],
    );
    if (!academicYearResult.rowCount) {
      academicYearResult = await client.query(
        `INSERT INTO academic_years (academic_year, start_date, end_date, status)
         VALUES ($1, $2, $3, 'Active') RETURNING academic_year_id`,
        [startingAcademicYear, `${admissionYear}-07-01`, `${admissionYear + 1}-06-30`],
      );
    }
    const startAcademicYearId = academicYearResult.rows[0].academic_year_id;
    if (Number.isInteger(admissionBatchId)) {
      const conflictingBatch = await client.query(
        `SELECT admission_batch_id FROM admission_batches
         WHERE programme_id = $1 AND batch_code = $2 AND admission_batch_id <> $3
         LIMIT 1`,
        [programmeId, batchCode, admissionBatchId],
      );
      if (conflictingBatch.rowCount) {
        throw new Error(`Batch ${batchCode} already exists for the selected Programme.`);
      }
    }
    const existingBatch = Number.isInteger(admissionBatchId)
      ? await client.query('SELECT admission_batch_id FROM admission_batches WHERE admission_batch_id = $1', [admissionBatchId])
      : await client.query(
          `SELECT admission_batch_id FROM admission_batches
           WHERE programme_id = $1 AND (admission_year = $2 OR batch_code = $3)
           ORDER BY admission_batch_id LIMIT 1`,
          [programmeId, admissionYear, batchCode],
        );
    if (Number.isInteger(admissionBatchId) && !existingBatch.rowCount) {
      throw new Error('Admission batch not found. Refresh the page and try again.');
    }
    const batchValues = [departmentId, programmeId, startAcademicYearId, durationYears, totalSemesters, startingAcademicYear, admissionYear, completionYear, batchCode, status];
    const batchResult = existingBatch.rowCount
      ? await client.query(`
          UPDATE admission_batches SET department_id = $1, programme_id = $2,
            start_academic_year_id = $3, duration_years = $4, total_semesters = $5,
            starting_academic_year = $6, admission_year = $7, completion_year = $8,
            batch_code = $9, status = $10, updated_at = CURRENT_TIMESTAMP
          WHERE admission_batch_id = $11 RETURNING *
        `, [...batchValues, existingBatch.rows[0].admission_batch_id])
      : await client.query(`
          INSERT INTO admission_batches (
            department_id, programme_id, start_academic_year_id, duration_years, total_semesters,
            starting_academic_year, admission_year, completion_year, batch_code, status, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
          RETURNING *
        `, batchValues);
    const batchId = batchResult.rows[0].admission_batch_id;
    for (let semesterNumber = 1; semesterNumber <= totalSemesters; semesterNumber += 1) {
      const academicStart = Number(startingAcademicYear.slice(0, 4)) + Math.floor((semesterNumber - 1) / 2);
      const academicYear = `${academicStart}-${String(academicStart + 1).slice(-2)}`;
      const remainderTen = semesterNumber % 10;
      const remainderHundred = semesterNumber % 100;
      const suffix = remainderHundred >= 11 && remainderHundred <= 13 ? 'th' : remainderTen === 1 ? 'st' : remainderTen === 2 ? 'nd' : remainderTen === 3 ? 'rd' : 'th';
      const semesterName = `${semesterNumber}${suffix} Semester`;
      const updatedSemester = await client.query(`
        UPDATE semesters SET department_id = $1, programme_id = $2,
          semester_no = $4, semester_number = $4, semester_name = $5,
          academic_year = $6, status = $7
        WHERE admission_batch_id = $3 AND COALESCE(semester_number, semester_no) = $4
      `, [departmentId, programmeId, batchId, semesterNumber, semesterName, academicYear, status]);
      if (!updatedSemester.rowCount) {
        await client.query(`
          INSERT INTO semesters (
            department_id, programme_id, admission_batch_id, semester_no,
            semester_number, semester_name, academic_year, status
          ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
        `, [departmentId, programmeId, batchId, semesterNumber, semesterName, academicYear, status]);
      }
    }
    await client.query(
      'DELETE FROM semesters WHERE admission_batch_id = $1 AND COALESCE(semester_number, semester_no) > $2',
      [batchId, totalSemesters],
    );
    await client.query('COMMIT');
    response.status(admissionBatchId ? 200 : 201).json({ message: `Batch ${batchCode} ${admissionBatchId ? 'updated' : 'created'} and ${totalSemesters} semesters generated.`, row: batchResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({ error: 'Unable to create admission batch.', detail: error.message });
  } finally {
    client.release();
  }
});

app.delete('/api/admission-batches/:admissionBatchId', async (request, response) => {
  const admissionBatchId = Number(request.params.admissionBatchId);
  if (!Number.isInteger(admissionBatchId)) {
    response.status(400).json({ error: 'Valid Admission Batch ID is required.' });
    return;
  }

  try {
    await ensureAdmissionBatchesTable();
    const result = await pool.query(
      'DELETE FROM admission_batches WHERE admission_batch_id = $1 RETURNING batch_code',
      [admissionBatchId],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: 'Admission batch not found.' });
      return;
    }
    response.json({ message: `Batch ${result.rows[0].batch_code} deleted successfully.` });
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/semesters', async (_request, response) => {
  try {
    await ensureAdmissionBatchesTable();
    const result = await pool.query(`
      SELECT
        semesters.semester_id,
        semesters.department_id,
        department.department_code,
        department.department_name,
        semesters.programme_id,
        semesters.admission_batch_id,
        admission_batches.admission_year,
        programmes.programme_code,
        programmes.programme_name,
        COALESCE(semesters.semester_number, semesters.semester_no) AS semester_number,
        semesters.semester_name,
        semesters.academic_year,
        semesters.status
      FROM semesters
      LEFT JOIN department ON department.department_id = semesters.department_id
      LEFT JOIN programmes ON programmes.programme_id = semesters.programme_id
      LEFT JOIN admission_batches ON admission_batches.admission_batch_id = semesters.admission_batch_id
      ORDER BY semesters.semester_id ASC
    `);

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/semesters', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_number: semesterNumber,
    semester_name: semesterName,
    academic_year: academicYear = '',
    admission_batch_id: admissionBatchId,
    status = 'Active',
  } = request.body;

  if (!departmentId || !programmeId || !admissionBatchId || !semesterNumber || !semesterName?.trim()) {
    response.status(400).json({
      error: 'Department, Programme, Admission Year, and Semester Number are required.',
    });
    return;
  }

  try {
    await ensureSemestersTable();
    const result = await pool.query(
      `
        INSERT INTO semesters (
          department_id,
          programme_id,
          semester_no,
          semester_number,
          semester_name,
          academic_year,
          status,
          admission_batch_id
        )
        VALUES ($1, $2, $3, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        departmentId,
        programmeId,
        Number(semesterNumber),
        semesterName.trim(),
        academicYear.trim(),
        status,
        Number(admissionBatchId) || null,
      ],
    );

    response.status(201).json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.put('/api/semesters/:semesterId', async (request, response) => {
  const { semesterId } = request.params;
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_number: semesterNumber,
    semester_name: semesterName,
    academic_year: academicYear = '',
    admission_batch_id: admissionBatchId,
    status = 'Active',
  } = request.body;

  if (!departmentId || !programmeId || !admissionBatchId || !semesterNumber || !semesterName?.trim()) {
    response.status(400).json({
      error: 'Department, Programme, Admission Year, and Semester Number are required.',
    });
    return;
  }

  try {
    await ensureSemestersTable();
    const result = await pool.query(
      `
        UPDATE semesters
        SET
          department_id = $1,
          programme_id = $2,
          semester_no = $3,
          semester_number = $3,
          semester_name = $4,
          academic_year = $5,
          status = $6,
          admission_batch_id = $7
        WHERE semester_id = $8
        RETURNING *
      `,
      [
        departmentId,
        programmeId,
        Number(semesterNumber),
        semesterName.trim(),
        academicYear.trim(),
        status,
        Number(admissionBatchId) || null,
        semesterId,
      ],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Semester not found.' });
      return;
    }

    response.json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.delete('/api/semesters/:semesterId', async (request, response) => {
  try {
    await ensureCoursesTable();
    const linkedCourses = await pool.query(
      'SELECT COUNT(*)::int AS course_count FROM courses WHERE semester_id = $1',
      [request.params.semesterId],
    );
    const courseCount = Number(linkedCourses.rows[0]?.course_count || 0);
    if (courseCount > 0) {
      response.status(409).json({
        error: `Cannot delete this semester because ${courseCount} course${courseCount === 1 ? '' : 's'} ${courseCount === 1 ? 'is' : 'are'} linked to it. Remove or reassign the linked courses first.`,
      });
      return;
    }
    const result = await pool.query(
      'DELETE FROM semesters WHERE semester_id = $1 RETURNING semester_id',
      [request.params.semesterId],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Semester not found.' });
      return;
    }

    response.status(204).send();
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/courses', async (_request, response) => {
  try {
    await ensureCoursesTable();
    const result = await pool.query(`
      SELECT
        courses.course_id,
        courses.department_id,
        department.department_code,
        department.department_name,
        courses.programme_id,
        programmes.programme_code,
        programmes.programme_name,
        courses.semester_id,
        COALESCE(semesters.semester_number, semesters.semester_no) AS semester_number,
        semesters.semester_name,
        courses.course_code,
        courses.course_name,
        courses.course_type,
        courses.credits,
        courses.lecture_hours,
        courses.tutorial_hours,
        courses.practical_hours,
        courses.total_marks,
        courses.status
      FROM courses
      LEFT JOIN department ON department.department_id = courses.department_id
      LEFT JOIN programmes ON programmes.programme_id = courses.programme_id
      LEFT JOIN semesters ON semesters.semester_id = courses.semester_id
      ORDER BY courses.course_id ASC
    `);

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/courses', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_code: courseCode,
    course_name: courseName,
    course_type: courseType = 'Theory',
    credits = 4,
    lecture_hours: lectureHours = 3,
    tutorial_hours: tutorialHours = 1,
    practical_hours: practicalHours = 0,
    total_marks: totalMarks = 100,
    status = 'Active',
  } = request.body;

  if (!departmentId || !programmeId || !semesterId || !courseCode?.trim() || !courseName?.trim()) {
    response.status(400).json({
      error: 'Department, Programme, Semester, Course Code, and Course Name are required.',
    });
    return;
  }

  try {
    await ensureCoursesTable();
    const result = await pool.query(
      `
        INSERT INTO courses (
          department_id,
          programme_id,
          semester_id,
          course_code,
          course_name,
          course_type,
          credits,
          lecture_hours,
          tutorial_hours,
          practical_hours,
          total_marks,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `,
      [
        departmentId,
        programmeId,
        semesterId,
        courseCode.trim().toUpperCase(),
        courseName.trim(),
        courseType,
        Number(credits),
        Number(lectureHours),
        Number(tutorialHours),
        Number(practicalHours),
        Number(totalMarks),
        status,
      ],
    );

    response.status(201).json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.put('/api/courses/:courseId', async (request, response) => {
  const { courseId } = request.params;
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_code: courseCode,
    course_name: courseName,
    course_type: courseType = 'Theory',
    credits = 4,
    lecture_hours: lectureHours = 3,
    tutorial_hours: tutorialHours = 1,
    practical_hours: practicalHours = 0,
    total_marks: totalMarks = 100,
    status = 'Active',
  } = request.body;

  if (!departmentId || !programmeId || !semesterId || !courseCode?.trim() || !courseName?.trim()) {
    response.status(400).json({
      error: 'Department, Programme, Semester, Course Code, and Course Name are required.',
    });
    return;
  }

  try {
    await ensureCoursesTable();
    const result = await pool.query(
      `
        UPDATE courses
        SET
          department_id = $1,
          programme_id = $2,
          semester_id = $3,
          course_code = $4,
          course_name = $5,
          course_type = $6,
          credits = $7,
          lecture_hours = $8,
          tutorial_hours = $9,
          practical_hours = $10,
          total_marks = $11,
          status = $12
        WHERE course_id = $13
        RETURNING *
      `,
      [
        departmentId,
        programmeId,
        semesterId,
        courseCode.trim().toUpperCase(),
        courseName.trim(),
        courseType,
        Number(credits),
        Number(lectureHours),
        Number(tutorialHours),
        Number(practicalHours),
        Number(totalMarks),
        status,
        courseId,
      ],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Course not found.' });
      return;
    }

    response.json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.delete('/api/courses/:courseId', async (request, response) => {
  try {
    await ensureCourseOutcomesTable();
    const result = await pool.query(
      'DELETE FROM courses WHERE course_id = $1 RETURNING course_id',
      [request.params.courseId],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Course not found.' });
      return;
    }

    response.status(204).send();
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/course-outcomes', async (request, response) => {
  try {
    await ensureCourseOutcomesTable();
    const courseId = request.query.course_id ? Number(request.query.course_id) : null;

    if (request.query.course_id && !Number.isInteger(courseId)) {
      response.status(400).json({ error: 'Course ID must be a number.' });
      return;
    }

    const result = await pool.query(
      `
      SELECT
        course_outcomes.co_id,
        course_outcomes.department_id,
        department.department_code,
        department.department_name,
        course_outcomes.programme_id,
        programmes.programme_code,
        programmes.programme_name,
        course_outcomes.semester_id,
        COALESCE(semesters.semester_number, semesters.semester_no) AS semester_number,
        semesters.semester_name,
        course_outcomes.course_id,
        courses.course_code,
        courses.course_name,
        course_outcomes.co_code,
        course_outcomes.co_statement,
        course_outcomes.bloom_id,
        course_outcomes.bloom_code,
        course_outcomes.bloom_level,
        course_outcomes.target_level,
        course_outcomes.status
      FROM course_outcomes
      LEFT JOIN department ON department.department_id = course_outcomes.department_id
      LEFT JOIN programmes ON programmes.programme_id = course_outcomes.programme_id
      LEFT JOIN semesters ON semesters.semester_id = course_outcomes.semester_id
      LEFT JOIN courses ON courses.course_id = course_outcomes.course_id
      ${courseId ? 'WHERE course_outcomes.course_id = $1' : ''}
      ORDER BY course_outcomes.co_id ASC
    `,
      courseId ? [courseId] : [],
    );

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/course-outcomes', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_id: courseId,
    co_code: coCode,
    co_statement: coStatement,
    bloom_level: bloomLevel = 'Understand',
    target_level: targetLevel = 2.5,
    status = 'Active',
  } = request.body;

  if (
    !departmentId ||
    !programmeId ||
    !semesterId ||
    !courseId ||
    !coCode?.trim() ||
    !coStatement?.trim()
  ) {
    response.status(400).json({
      error: 'Department, Programme, Semester, Course, CO Code, and CO Statement are required.',
    });
    return;
  }

  try {
    await ensureCourseOutcomesTable();
    const bloomMatch = await findBloomLevelForStatement(coStatement.trim(), bloomLevel);

    if (bloomMatch.bloomId === null || bloomMatch.bloomId === undefined) {
      response.status(400).json({
        error: 'Bloom Level setup is incomplete.',
        detail: 'No bloom_id could be found or created in bloom_level.',
      });
      return;
    }

    const result = await pool.query(
      `
        INSERT INTO course_outcomes (
          department_id,
          programme_id,
          semester_id,
          course_id,
          co_code,
          co_statement,
          bloom_id,
          bloom_code,
          bloom_level,
          target_level,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `,
      [
        departmentId,
        programmeId,
        semesterId,
        courseId,
        coCode.trim().toUpperCase(),
        coStatement.trim(),
        bloomMatch.bloomId,
        bloomMatch.bloomCode,
        bloomMatch.bloomLevel,
        Number(targetLevel),
        status,
      ],
    );

    response.status(201).json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.put('/api/course-outcomes/:coId', async (request, response) => {
  const { coId } = request.params;
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_id: courseId,
    co_code: coCode,
    co_statement: coStatement,
    bloom_level: bloomLevel = 'Understand',
    target_level: targetLevel = 2.5,
    status = 'Active',
  } = request.body;

  if (
    !departmentId ||
    !programmeId ||
    !semesterId ||
    !courseId ||
    !coCode?.trim() ||
    !coStatement?.trim()
  ) {
    response.status(400).json({
      error: 'Department, Programme, Semester, Course, CO Code, and CO Statement are required.',
    });
    return;
  }

  try {
    await ensureCourseOutcomesTable();
    const bloomMatch = await findBloomLevelForStatement(coStatement.trim(), bloomLevel);

    if (bloomMatch.bloomId === null || bloomMatch.bloomId === undefined) {
      response.status(400).json({
        error: 'Bloom Level setup is incomplete.',
        detail: 'No bloom_id could be found or created in bloom_level.',
      });
      return;
    }

    const result = await pool.query(
      `
        UPDATE course_outcomes
        SET
          department_id = $1,
          programme_id = $2,
          semester_id = $3,
          course_id = $4,
          co_code = $5,
          co_statement = $6,
          bloom_id = $7,
          bloom_code = $8,
          bloom_level = $9,
          target_level = $10,
          status = $11
        WHERE co_id = $12
        RETURNING *
      `,
      [
        departmentId,
        programmeId,
        semesterId,
        courseId,
        coCode.trim().toUpperCase(),
        coStatement.trim(),
        bloomMatch.bloomId,
        bloomMatch.bloomCode,
        bloomMatch.bloomLevel,
        Number(targetLevel),
        status,
        coId,
      ],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Course outcome not found.' });
      return;
    }

    response.json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.delete('/api/course-outcomes/:coId', async (request, response) => {
  try {
    await ensureCourseOutcomesTable();
    const result = await pool.query(
      'DELETE FROM course_outcomes WHERE co_id = $1 RETURNING co_id',
      [request.params.coId],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Course outcome not found.' });
      return;
    }

    response.status(204).send();
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/dashboard-content', async (_request, response) => {
  try {
    await ensureDashboardContentTable();
    const result = await pool.query(`
      SELECT dashboard_content_id, content_type, content_label, content_statement, icon, theme_color, status
      FROM dashboard_content
      WHERE status = 'Active'
      ORDER BY CASE content_type WHEN 'VISION' THEN 1 WHEN 'MISSION' THEN 2 ELSE 3 END,
        dashboard_content_id
    `);
    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/dashboard-content/:contentType', async (request, response) => {
  const contentType = String(request.params.contentType || '').trim().toUpperCase();
  const contentLabel = String(request.body.content_label || contentType).trim();
  const contentStatement = String(request.body.content_statement || '').trim();
  const status = String(request.body.status || 'Active').trim();

  if (!['VISION', 'MISSION'].includes(contentType) || !contentStatement) {
    response.status(400).json({ error: 'Vision or Mission type and Statement are required.' });
    return;
  }

  try {
    await ensureDashboardContentTable();
    const result = await pool.query(`
      INSERT INTO dashboard_content (
        content_type, content_label, content_statement, status, updated_at
      )
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (content_type) DO UPDATE SET
        content_label = EXCLUDED.content_label,
        content_statement = EXCLUDED.content_statement,
        status = EXCLUDED.status,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [contentType, contentLabel || contentType, contentStatement, status || 'Active']);
    response.json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/department-vision-mission', async (request, response) => {
  const departmentId = Number(request.query.department_id);
  if (!Number.isInteger(departmentId)) {
    response.status(400).json({ error: 'Department is required.' });
    return;
  }
  try {
    await ensureDepartmentVisionMissionTable();
    const result = await pool.query(`
      SELECT department_vision_mission.*, department.department_code, department.department_name
      FROM department_vision_mission
      JOIN department ON department.department_id = department_vision_mission.department_id
      WHERE department_vision_mission.department_id = $1
      ORDER BY CASE content_type WHEN 'VISION' THEN 1 ELSE 2 END
    `, [departmentId]);
    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/department-vision-mission/:contentType', async (request, response) => {
  const departmentId = Number(request.body.department_id);
  const contentType = String(request.params.contentType || '').trim().toUpperCase();
  const contentTitle = String(request.body.content_title || contentType).trim();
  const contentStatement = String(request.body.content_statement || '').trim();
  const status = String(request.body.status || 'Active').trim();
  if (!Number.isInteger(departmentId) || !['VISION', 'MISSION'].includes(contentType) || !contentStatement) {
    response.status(400).json({ error: 'Department, Vision or Mission type, and Statement are required.' });
    return;
  }
  try {
    await ensureDepartmentVisionMissionTable();
    const result = await pool.query(`
      INSERT INTO department_vision_mission (
        department_id, content_type, content_title, content_statement, status, updated_at
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (department_id, content_type) DO UPDATE SET
        content_title = EXCLUDED.content_title,
        content_statement = EXCLUDED.content_statement,
        status = EXCLUDED.status,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [departmentId, contentType, contentTitle || contentType, contentStatement, status || 'Active']);
    response.json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/programme-outcomes', async (_request, response) => {
  try {
    await ensureProgrammeOutcomesTable();
    const result = await pool.query(`
      SELECT
        programme_outcomes.po_id,
        programme_outcomes.outcome_id,
        programme_outcomes.department_id,
        department.department_code,
        department.department_name,
        programme_outcomes.programme_id,
        programmes.programme_code,
        programmes.programme_name,
        programme_outcomes.outcome_type,
        COALESCE(NULLIF(programme_outcomes.outcome_code, ''), NULLIF(programme_outcomes.po_code, ''), NULLIF(programme_outcomes.pso_code, '')) AS outcome_code,
        COALESCE(NULLIF(programme_outcomes.outcome_title, ''), NULLIF(programme_outcomes.po_title, ''), NULLIF(programme_outcomes.pso_title, '')) AS outcome_title,
        COALESCE(NULLIF(programme_outcomes.outcome_statement, ''), NULLIF(programme_outcomes.po_statement, ''), NULLIF(programme_outcomes.pso_statement, '')) AS outcome_statement,
        programme_outcomes.status
      FROM programme_outcomes
      LEFT JOIN department ON department.department_id = programme_outcomes.department_id
      LEFT JOIN programmes ON programmes.programme_id = programme_outcomes.programme_id
      ORDER BY programme_outcomes.outcome_type ASC, programme_outcomes.outcome_id ASC
    `);

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/programme-outcomes', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    outcome_type: outcomeType,
    outcome_code: outcomeCode,
    po_code: poCode,
    pso_code: psoCode,
    outcome_title: outcomeTitle,
    outcome_statement: outcomeStatement,
    status = 'Active',
  } = request.body;
  const rawOutcomeCode = outcomeCode || poCode || psoCode;

  if (
    !departmentId ||
    !programmeId ||
    !outcomeType?.trim() ||
    !rawOutcomeCode?.trim() ||
    !outcomeTitle?.trim() ||
    !outcomeStatement?.trim()
  ) {
    response.status(400).json({
      error: 'Department, Programme, Code, Title, and Statement are required.',
    });
    return;
  }

  try {
    await ensureProgrammeOutcomesTable();
    const normalizedOutcomeType = outcomeType.trim().toUpperCase();
    const normalizedOutcomeCode = normalizeOutcomeCode(normalizedOutcomeType, rawOutcomeCode);
    const result = await pool.query(
      `
        INSERT INTO programme_outcomes (
          department_id,
          programme_id,
          outcome_type,
          outcome_code,
          po_code,
          pso_code,
          po_title,
          pso_title,
          po_statement,
          pso_statement,
          outcome_title,
          outcome_statement,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $8, $7, $8, $9)
        RETURNING *
      `,
      [
        departmentId,
        programmeId,
        normalizedOutcomeType,
        normalizedOutcomeCode,
        normalizedOutcomeCode,
        normalizedOutcomeCode,
        outcomeTitle.trim(),
        outcomeStatement.trim(),
        status,
      ],
    );

    response.status(201).json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.put('/api/programme-outcomes/:outcomeId', async (request, response) => {
  const { outcomeId } = request.params;
  const {
    department_id: departmentId,
    programme_id: programmeId,
    outcome_type: outcomeType,
    outcome_code: outcomeCode,
    po_code: poCode,
    pso_code: psoCode,
    outcome_title: outcomeTitle,
    outcome_statement: outcomeStatement,
    status = 'Active',
  } = request.body;
  const rawOutcomeCode = outcomeCode || poCode || psoCode;

  if (
    !departmentId ||
    !programmeId ||
    !outcomeType?.trim() ||
    !rawOutcomeCode?.trim() ||
    !outcomeTitle?.trim() ||
    !outcomeStatement?.trim()
  ) {
    response.status(400).json({
      error: 'Department, Programme, Code, Title, and Statement are required.',
    });
    return;
  }

  try {
    await ensureProgrammeOutcomesTable();
    const normalizedOutcomeType = outcomeType.trim().toUpperCase();
    const normalizedOutcomeCode = normalizeOutcomeCode(normalizedOutcomeType, rawOutcomeCode);
    const result = await pool.query(
      `
        UPDATE programme_outcomes
        SET
          department_id = $1,
          programme_id = $2,
          outcome_type = $3,
          outcome_code = $4,
          po_code = $5,
          pso_code = $6,
          po_title = $7,
          pso_title = $7,
          po_statement = $8,
          pso_statement = $8,
          outcome_title = $7,
          outcome_statement = $8,
          status = $9
        WHERE outcome_id = $10
        RETURNING *
      `,
      [
        departmentId,
        programmeId,
        normalizedOutcomeType,
        normalizedOutcomeCode,
        normalizedOutcomeCode,
        normalizedOutcomeCode,
        outcomeTitle.trim(),
        outcomeStatement.trim(),
        status,
        outcomeId,
      ],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Programme outcome not found.' });
      return;
    }

    response.json(result.rows[0]);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.delete('/api/programme-outcomes/:outcomeId', async (request, response) => {
  try {
    await ensureProgrammeOutcomesTable();
    const result = await pool.query(
      'DELETE FROM programme_outcomes WHERE outcome_id = $1 RETURNING outcome_id',
      [request.params.outcomeId],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Programme outcome not found.' });
      return;
    }

    response.status(204).send();
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/co-po-mapping', async (request, response) => {
  const courseId = request.query.course_id ? Number(request.query.course_id) : null;

  if (!courseId || !Number.isInteger(courseId)) {
    response.status(400).json({ error: 'Course ID is required.' });
    return;
  }

  try {
    await ensureCoPoMappingTable();

    const result = await pool.query(
      `
        SELECT
          co_po_mapping.mapping_id,
          co_po_mapping.co_id,
          course_outcomes.co_code,
          co_po_mapping.po_id,
          programme_outcomes.outcome_type,
          COALESCE(
            NULLIF(programme_outcomes.outcome_code, ''),
            NULLIF(programme_outcomes.po_code, ''),
            NULLIF(programme_outcomes.pso_code, '')
          ) AS outcome_code,
          co_po_mapping.mapping_level
        FROM co_po_mapping
        JOIN course_outcomes ON course_outcomes.co_id = co_po_mapping.co_id
        JOIN programme_outcomes ON programme_outcomes.po_id = co_po_mapping.po_id
        WHERE course_outcomes.course_id = $1
        ORDER BY course_outcomes.co_id ASC, programme_outcomes.outcome_type ASC, programme_outcomes.po_id ASC
      `,
      [courseId],
    );

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/co-po-mapping', async (request, response) => {
  const rows = Array.isArray(request.body.mappings) ? request.body.mappings : [];

  if (!rows.length) {
    response.status(400).json({ error: 'At least one mapping row is required.' });
    return;
  }

  const client = await pool.connect();

  try {
    await ensureCoPoMappingTable();
    await client.query('BEGIN');

    for (const row of rows) {
      const coId = Number(row.co_id);
      const poId = Number(row.po_id);
      const mappingLevel = Number(row.mapping_level);

      if (
        !Number.isInteger(coId) ||
        coId <= 0 ||
        !Number.isInteger(poId) ||
        poId <= 0 ||
        !Number.isInteger(mappingLevel) ||
        mappingLevel < 0 ||
        mappingLevel > 3
      ) {
        throw new Error('Invalid CO-PO mapping row.');
      }

      await client.query(
        `
          INSERT INTO co_po_mapping (
            co_id,
            po_id,
            mapping_level
          )
          VALUES ($1, $2, $3)
          ON CONFLICT (co_id, po_id)
          DO UPDATE SET
            mapping_level = EXCLUDED.mapping_level
        `,
        [coId, poId, mappingLevel],
      );
    }

    await client.query('COMMIT');
    response.json({ message: `${rows.length} mapping rows saved to co_po_mapping.` });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({
      error: 'Unable to save CO-PO mapping.',
      detail: error.message,
    });
  } finally {
    client.release();
  }
});

app.get('/api/students', async (request, response) => {
  const departmentId = request.query.department_id ? Number(request.query.department_id) : null;
  const programmeId = request.query.programme_id ? Number(request.query.programme_id) : null;
  const semesterId = request.query.semester_id ? Number(request.query.semester_id) : null;

  if (
    (request.query.department_id && !Number.isInteger(departmentId)) ||
    (request.query.programme_id && !Number.isInteger(programmeId)) ||
    (request.query.semester_id && !Number.isInteger(semesterId))
  ) {
    response.status(400).json({ error: 'Department, Programme, and Semester IDs must be numbers.' });
    return;
  }

  const filters = [];
  const values = [];

  if (departmentId) {
    values.push(departmentId);
    filters.push(`students.department_id = $${values.length}`);
  }

  if (programmeId) {
    values.push(programmeId);
    filters.push(`students.programme_id = $${values.length}`);
  }

  if (semesterId) {
    values.push(semesterId);
    filters.push(`students.semester_id = $${values.length}`);
  }

  if (request.query.section) {
    values.push(String(request.query.section).trim());
    filters.push(`students.section = $${values.length}`);
  }

  if (request.query.batch) {
    values.push(String(request.query.batch).trim());
    filters.push(`students.batch = $${values.length}`);
  }

  if (request.query.academic_year) {
    values.push(String(request.query.academic_year).trim());
    filters.push(`students.academic_year = $${values.length}`);
  }

  try {
    await ensureStudentsTable();
    const result = await pool.query(
      `
        SELECT
          students.*,
          COALESCE(students.registration_no, students.regd_no) AS registration_no,
          department.department_name,
          programmes.programme_name,
          COALESCE(semesters.semester_name, semesters.semester_no::text) AS semester_name
        FROM students
        LEFT JOIN department ON department.department_id = students.department_id
        LEFT JOIN programmes ON programmes.programme_id = students.programme_id
        LEFT JOIN semesters ON semesters.semester_id = students.semester_id
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        ORDER BY students.student_id ASC
      `,
      values,
    );

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/students', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    section,
    batch,
    academic_year: academicYear = '',
    replace_existing: replaceExisting = false,
    rows,
  } = request.body;
  const studentRows = Array.isArray(rows) ? rows : [request.body];
  const requestedSection = String(section || '').trim();
  const storedSection = requestedSection || 'A';

  if (!departmentId || !programmeId || !batch || !studentRows.length) {
    response.status(400).json({
      error: 'Department, Programme, Batch, and student rows are required.',
    });
    return;
  }

  const client = await pool.connect();

  try {
    await ensureStudentsTable();
    await client.query('BEGIN');
    if (replaceExisting) {
      const replaceValues = [Number(departmentId), Number(programmeId), String(batch).trim()];
      await client.query(`
        DELETE FROM students
        WHERE department_id = $1 AND programme_id = $2 AND batch = $3
          ${requestedSection ? 'AND section = $4' : ''}
      `, requestedSection ? [...replaceValues, requestedSection] : replaceValues);
    }

    for (const row of studentRows) {
      const registrationNo = String(row.registration_no || row.regd_no || '').trim();
      const studentName = String(row.student_name || '').trim();

      if (!registrationNo || !studentName) {
        throw new Error('Each student row must include Registration No and Student Name.');
      }

      if (!replaceExisting) {
        const duplicateValues = [
          Number(departmentId),
          Number(programmeId),
          String(batch).trim(),
          registrationNo,
        ];
        await client.query(`
          DELETE FROM students
          WHERE department_id = $1 AND programme_id = $2 AND batch = $3
            AND COALESCE(registration_no, regd_no) = $4
            ${requestedSection ? 'AND section = $5' : ''}
        `, requestedSection ? [...duplicateValues, requestedSection] : duplicateValues);
      }

      await client.query(
        `
          INSERT INTO students (
            department_id,
            programme_id,
            semester_id,
            section,
            batch,
            academic_year,
            regd_no,
            registration_no,
            university_regd,
            roll_number,
            student_name,
            status,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
        `,
        [
          Number(departmentId),
          Number(programmeId),
          semesterId ? Number(semesterId) : null,
          storedSection,
          String(batch).trim(),
          String(academicYear).trim(),
          registrationNo,
          String(row.university_regd || '').trim(),
          String(row.roll_number || '').trim(),
          studentName,
          String(row.status || 'Active').trim(),
        ],
      );
    }

    await client.query('COMMIT');
    response.status(201).json({
      message: `${studentRows.length} student row${studentRows.length === 1 ? '' : 's'} saved.`,
      count: studentRows.length,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({
      error: 'Unable to save students.',
      detail: error.message,
    });
  } finally {
    client.release();
  }
});

app.get('/api/student-course-enrollments', async (request, response) => {
  const courseId = Number(request.query.course_id);
  const facultyId = Number(request.query.faculty_id);
  const academicYear = String(request.query.academic_year || '').trim();
  const section = String(request.query.section || '').trim();

  if (!Number.isInteger(courseId) || !Number.isInteger(facultyId) || !academicYear || !section) {
    response.status(400).json({ error: 'Course, Faculty, Academic Year, and Section are required.' });
    return;
  }

  try {
    await ensureStudentCourseEnrollmentsTable();
    const result = await pool.query(
      `SELECT student_id FROM student_course_enrollments
       WHERE course_id = $1 AND faculty_id = $2 AND academic_year = $3 AND section = $4 AND status = 'Active'`,
      [courseId, facultyId, academicYear, section],
    );
    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/student-course-enrollments', async (request, response) => {
  const courseId = Number(request.body.course_id);
  const facultyId = Number(request.body.faculty_id);
  const academicYear = String(request.body.academic_year || '').trim();
  const section = String(request.body.section || '').trim();
  const studentIds = [...new Set((Array.isArray(request.body.student_ids) ? request.body.student_ids : []).map(Number))]
    .filter(Number.isInteger);

  if (!Number.isInteger(courseId) || !Number.isInteger(facultyId) || !academicYear || !section) {
    response.status(400).json({ error: 'Course, Faculty, Academic Year, and Section are required.' });
    return;
  }

  const client = await pool.connect();
  try {
    await ensureStudentCourseEnrollmentsTable();
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM student_course_enrollments
       WHERE course_id = $1 AND faculty_id = $2 AND academic_year = $3 AND section = $4`,
      [courseId, facultyId, academicYear, section],
    );
    for (const studentId of studentIds) {
      await client.query(
        `INSERT INTO student_course_enrollments
          (student_id, course_id, faculty_id, academic_year, section, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [studentId, courseId, facultyId, academicYear, section],
      );
    }
    await client.query('COMMIT');
    response.status(201).json({ message: `${studentIds.length} student enrollment${studentIds.length === 1 ? '' : 's'} saved.`, count: studentIds.length });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({ error: 'Unable to save student course enrollments.', detail: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/articulation-matrix', async (request, response) => {
  const courseId = request.query.course_id ? Number(request.query.course_id) : null;

  if (request.query.course_id && !Number.isInteger(courseId)) {
    response.status(400).json({ error: 'Course ID must be a number.' });
    return;
  }

  try {
    await ensureArticulationMatrixTable();
    const result = await pool.query(
      `
        SELECT *
        FROM articulation_matrix
        ${courseId ? "WHERE course_id = $1 AND outcome_code = 'INTERNAL'" : "WHERE outcome_code = 'INTERNAL'"}
        ORDER BY co_code ASC
      `,
      courseId ? [courseId] : [],
    );

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/articulation-matrix', async (request, response) => {
  const { course_id: courseId, academic_year: academicYear = '2024-25', rows = [] } = request.body;

  if (!Number.isInteger(Number(courseId))) {
    response.status(400).json({ error: 'Course ID is required.' });
    return;
  }

  if (!Array.isArray(rows) || !rows.length) {
    response.status(400).json({ error: 'At least one articulation row is required.' });
    return;
  }

  const client = await pool.connect();

  try {
    await ensureArticulationMatrixTable();
    await client.query('BEGIN');
    await client.query(
      "DELETE FROM articulation_matrix WHERE course_id = $1 AND outcome_code = 'INTERNAL'",
      [Number(courseId)],
    );

    const assessmentColumns = ['attend', 'a1', 'a2', 'qt1', 'qt2', 'st1', 'st2', 'ct1', 'ct2', 'end_sem'];
    const articulationComponentId = await getOrCreateArticulationComponentId(
      client,
      Number(courseId),
      String(academicYear || '2024-25').trim(),
    );

    for (const row of rows) {
      const values = assessmentColumns.map((column) => Number(row[column] ?? 0));

      if (
        values.some((value) => !Number.isInteger(value) || value < 0 || value > 3) ||
        !row.co_code
      ) {
        throw new Error('Invalid articulation matrix row.');
      }

      await client.query(
        `
          INSERT INTO articulation_matrix (
            department_id,
            programme_id,
            semester_id,
            course_id,
            co_id,
            outcome_id,
            component_id,
            academic_year,
            department_name,
            programme_name,
            semester_name,
            course_code,
            course_name,
            co_code,
            co_statement,
            outcome_type,
            outcome_code,
            outcome_title,
            articulation_level,
            attend,
            a1,
            a2,
            qt1,
            qt2,
            st1,
            st2,
            ct1,
            ct2,
            end_sem,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            $21, $22, $23, $24, $25, $26, $27, $28, $29, CURRENT_TIMESTAMP
          )
        `,
        [
          Number(row.department_id) || null,
          Number(row.programme_id) || null,
          Number(row.semester_id) || null,
          Number(courseId),
          Number(row.co_id) || null,
          Number(row.outcome_id) || null,
          articulationComponentId,
          String(row.academic_year || academicYear || '2024-25').trim(),
          String(row.department_name || '').trim(),
          String(row.programme_name || '').trim(),
          String(row.semester_name || '').trim(),
          String(row.course_code || '').trim().toUpperCase(),
          String(row.course_name || '').trim(),
          String(row.co_code || '').trim().toUpperCase(),
          String(row.co_statement || '').trim(),
          'PO',
          'INTERNAL',
          'Internal Assessment',
          0,
          ...values,
        ],
      );
    }

    await client.query('COMMIT');
    response.status(201).json({
      message: `${rows.length} articulation matrix rows saved.`,
      count: rows.length,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({
      error: 'Unable to save articulation matrix.',
      detail: error.message,
    });
  } finally {
    client.release();
  }
});

app.get('/api/internal-marks-upload', async (request, response) => {
  const courseId = request.query.course_id ? Number(request.query.course_id) : null;

  if (request.query.course_id && !Number.isInteger(courseId)) {
    response.status(400).json({ error: 'Course ID must be a number.' });
    return;
  }

  try {
    await ensureInternalMarksUploadTable();
    const result = await pool.query(
      `
        SELECT
          internal_marks_upload.*,
          department.department_code,
          department.department_name,
          programmes.programme_code,
          programmes.programme_name,
          COALESCE(semesters.semester_number, semesters.semester_no) AS semester_number,
          semesters.semester_name
        FROM internal_marks_upload
        LEFT JOIN department ON department.department_id = internal_marks_upload.department_id
        LEFT JOIN programmes ON programmes.programme_id = internal_marks_upload.programme_id
        LEFT JOIN semesters ON semesters.semester_id = internal_marks_upload.semester_id
        ${courseId ? 'WHERE internal_marks_upload.course_id = $1' : ''}
        ORDER BY internal_marks_upload.internal_mark_id ASC
      `,
      courseId ? [courseId] : [],
    );

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/internal-marks-upload', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_id: courseId,
    academic_year: academicYear = '2023-24',
    branch = '',
    rows = [],
  } = request.body;

  if (
    !departmentId ||
    !programmeId ||
    !semesterId ||
    !courseId ||
    !academicYear ||
    !Array.isArray(rows) ||
    !rows.length
  ) {
    response.status(400).json({
      error: 'Department, Programme, Semester, Course, Academic Year, and internal mark rows are required.',
    });
    return;
  }

  const client = await pool.connect();

  try {
    await ensureInternalMarksUploadTable();
    await client.query('BEGIN');
    await client.query(
      `
        DELETE FROM internal_marks_upload
        WHERE course_id = $1
          AND academic_year = $2
          AND branch = $3
      `,
      [courseId, academicYear, String(branch).trim()],
    );

    for (const row of rows) {
      const regdNo = String(row.regd_no || row.registration_no || '').trim();
      const studentName = String(row.student_name || '').trim();
      const attd = Number(row.attd) || 0;
      const a1 = Number(row.a1) || 0;
      const a2 = Number(row.a2) || 0;
      const qt1 = Number(row.qt1) || 0;
      const qt2 = Number(row.qt2) || 0;
      const st1 = Number(row.st1) || 0;
      const st2 = Number(row.st2) || 0;
      const ct1 = Number(row.ct1) || 0;
      const ct2 = Number(row.ct2) || 0;
      const calculatedInternalMark = attd + a1 + a2 + qt1 + qt2 + st1 + st2 + ct1 + ct2;
      const internalMark = Number.isFinite(Number(row.internal_mark))
        ? Number(row.internal_mark)
        : calculatedInternalMark;

      if (!regdNo || !studentName || !Number.isFinite(internalMark)) {
        throw new Error('Each row must include Regd. No., Student Name, and Internal Mark.');
      }

      await client.query(
        `
          INSERT INTO internal_marks_upload (
            department_id,
            programme_id,
            semester_id,
            course_id,
            academic_year,
            branch,
            sl_no,
            regd_no,
            student_name,
            attd,
            a1,
            a2,
            qt1,
            qt2,
            st1,
            st2,
            ct1,
            ct2,
            internal_mark
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `,
        [
          departmentId,
          programmeId,
          semesterId,
          courseId,
          String(academicYear).trim(),
          String(branch).trim(),
          Number(row.sl_no) || null,
          regdNo,
          studentName,
          attd,
          a1,
          a2,
          qt1,
          qt2,
          st1,
          st2,
          ct1,
          ct2,
          internalMark,
        ],
      );
    }

    await client.query('COMMIT');
    response.status(201).json({
      message: `${rows.length} internal mark rows saved.`,
      count: rows.length,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({
      error: 'Unable to save internal marks.',
      detail: error.message,
    });
  } finally {
    client.release();
  }
});

app.get('/api/external-marks-upload', async (request, response) => {
  const courseId = request.query.course_id ? Number(request.query.course_id) : null;
  const academicYear = String(request.query.academic_year || '').trim();

  if (request.query.course_id && !Number.isInteger(courseId)) {
    response.status(400).json({ error: 'Course ID must be a number.' });
    return;
  }

  try {
    await ensureExternalMarksUploadTable();
    const result = await pool.query(
      `
        SELECT
          external_marks_upload.*,
          department.department_code,
          department.department_name,
          programmes.programme_code,
          programmes.programme_name,
          COALESCE(semesters.semester_number, semesters.semester_no) AS semester_number,
          semesters.semester_name
        FROM external_marks_upload
        LEFT JOIN department ON department.department_id = external_marks_upload.department_id
        LEFT JOIN programmes ON programmes.programme_id = external_marks_upload.programme_id
        LEFT JOIN semesters ON semesters.semester_id = external_marks_upload.semester_id
        ${courseId ? `WHERE external_marks_upload.course_id = $1${academicYear ? ' AND external_marks_upload.academic_year = $2' : ''}` : ''}
        ORDER BY external_marks_upload.mark_id ASC
      `,
      courseId ? (academicYear ? [courseId, academicYear] : [courseId]) : [],
    );

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/external-marks-upload', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_id: courseId,
    academic_year: academicYear = '2024-25',
    average_mark: averageMark,
    target_average: targetAverage,
    attainment_value: attainmentValue,
    calculation_summary: calculationSummary = {},
    rows = [],
  } = request.body;

  if (
    !departmentId ||
    !programmeId ||
    !semesterId ||
    !courseId ||
    !academicYear ||
    !Array.isArray(rows) ||
    !rows.length
  ) {
    response.status(400).json({
      error: 'Department, Programme, Semester, Course, Academic Year, and marks rows are required.',
    });
    return;
  }

  const client = await pool.connect();

  try {
    await ensureExternalMarksUploadTable();
    await client.query('BEGIN');
    await client.query(
      `
        DELETE FROM external_marks_upload
        WHERE course_id = $1
          AND academic_year = $2
      `,
      [courseId, academicYear],
    );

    for (const row of rows) {
      const regdNo = String(row.regd_no || '').trim();
      const studentName = String(row.student_name || '').trim();
      const grade = String(row.grade || '').trim().toUpperCase();
      const percentMark = Number(row.percent_mark);

      if (!regdNo || !studentName || !Number.isFinite(percentMark)) {
        throw new Error('Each row must include Regd. No., Student Name, and % Mark.');
      }

      await client.query(
        `
          INSERT INTO external_marks_upload (
            department_id,
            programme_id,
            semester_id,
            course_id,
            academic_year,
            sl_no,
            regd_no,
            student_name,
            sgpa,
            grade,
            course_code,
            course_name,
            percent_mark,
            average_mark,
            target_average,
            attainment_value,
            calculation_summary
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `,
        [
          departmentId,
          programmeId,
          semesterId,
          courseId,
          academicYear,
          Number(row.sl_no) || null,
          regdNo,
          studentName,
          Number(row.sgpa) || null,
          grade,
          String(row.course_code || '').trim(),
          String(row.course_name || '').trim(),
          percentMark,
          Number(averageMark),
          Number(targetAverage),
          Number(attainmentValue),
          JSON.stringify(calculationSummary || {}),
        ],
      );
    }

    await client.query('COMMIT');
    response.status(201).json({
      message: `${rows.length} external mark rows saved.`,
      count: rows.length,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({
      error: 'Unable to save external marks.',
      detail: error.message,
    });
  } finally {
    client.release();
  }
});

app.get('/api/mark-attainment', async (request, response) => {
  const courseId = request.query.course_id ? Number(request.query.course_id) : null;
  const academicYear = String(request.query.academic_year || '').trim();

  if (!Number.isInteger(courseId) || !academicYear) {
    response.status(400).json({ error: 'Course ID and Academic Year are required.' });
    return;
  }

  try {
    await ensureMarkAttainmentTable();
    const result = await pool.query(
      `
        SELECT
          mark_attainment_id,
          department_id,
          programme_id,
          semester_id,
          course_id,
          academic_year,
          assessment_tool,
          tool_label,
          weightage,
          target_average,
          attainment_percent,
          level,
          level_point
        FROM mark_attainment
        WHERE course_id = $1
          AND academic_year = $2
        ORDER BY
          CASE assessment_tool
            WHEN 'attd' THEN 1
            WHEN 'a1' THEN 2
            WHEN 'a2' THEN 3
            WHEN 'qt1' THEN 4
            WHEN 'qt2' THEN 5
            WHEN 'st1' THEN 6
            WHEN 'st2' THEN 7
            WHEN 'ct1' THEN 8
            WHEN 'ct2' THEN 9
            WHEN 'end_sem' THEN 10
            ELSE 99
          END
      `,
      [courseId, academicYear],
    );

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/mark-attainment', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_id: courseId,
    academic_year: academicYear = '2024-25',
    rows = [],
  } = request.body;

  if (
    !departmentId ||
    !programmeId ||
    !semesterId ||
    !courseId ||
    !academicYear ||
    !Array.isArray(rows) ||
    !rows.length
  ) {
    response.status(400).json({
      error: 'Department, Programme, Semester, Course, Academic Year, and Mark Attainment rows are required.',
    });
    return;
  }

  const client = await pool.connect();

  try {
    await ensureMarkAttainmentTable();
    await client.query('BEGIN');
    await client.query(
      `
        DELETE FROM mark_attainment
        WHERE course_id = $1
          AND academic_year = $2
      `,
      [courseId, String(academicYear).trim()],
    );

    for (const row of rows) {
      const assessmentTool = String(row.assessment_tool || '').trim();
      const toolLabel = String(row.tool_label || assessmentTool).trim();

      if (!assessmentTool || !toolLabel) {
        throw new Error('Each row must include Assessment Tool and Tool Label.');
      }

      await client.query(
        `
          INSERT INTO mark_attainment (
            department_id,
            programme_id,
            semester_id,
            course_id,
            academic_year,
            assessment_tool,
            tool_label,
            weightage,
            target_average,
            attainment_percent,
            level,
            level_point
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `,
        [
          departmentId,
          programmeId,
          semesterId,
          courseId,
          String(academicYear).trim(),
          assessmentTool,
          toolLabel,
          Number(row.weightage) || 0,
          Number(row.target_average) || 0,
          Number(row.attainment_percent) || 0,
          String(row.level || '').trim(),
          Number.isFinite(Number(row.level_point)) ? Number(row.level_point) : null,
        ],
      );
    }

    await client.query('COMMIT');
    response.status(201).json({
      message: `${rows.length} Mark Attainment rows saved.`,
      count: rows.length,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({
      error: 'Unable to save Mark Attainment.',
      detail: error.message,
    });
  } finally {
    client.release();
  }
});

app.get('/api/co-attainment-calculation', async (request, response) => {
  const courseId = request.query.course_id ? Number(request.query.course_id) : null;
  const academicYear = String(request.query.academic_year || '').trim();
  const batch = String(request.query.batch || '').trim();

  if (!Number.isInteger(courseId) || !academicYear) {
    response.status(400).json({ error: 'Course ID and Academic Year are required.' });
    return;
  }

  try {
    await ensureCoAttainmentCalculationTable();
    const result = await pool.query(
      batch ? `
        SELECT
          calculation_id,
          department_id,
          programme_id,
          semester_id,
          course_id,
          academic_year,
          batch,
          internal_weight,
          external_weight,
          row_data
        FROM co_attainment_calculation
        WHERE course_id = $1
          AND academic_year = $2
          AND batch = $3
        ORDER BY calculation_id DESC
        LIMIT 1
      ` : `
        SELECT
          calculation_id, department_id, programme_id, semester_id, course_id,
          academic_year, batch, internal_weight, external_weight, row_data
        FROM co_attainment_calculation
        WHERE course_id = $1 AND academic_year = $2
        ORDER BY updated_at DESC, calculation_id DESC
        LIMIT 1
      `,
      batch ? [courseId, academicYear, batch] : [courseId, academicYear],
    );

    response.json(result.rows[0] || null);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/co-attainment-calculation', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_id: courseId,
    academic_year: academicYear = '2024-25',
    batch = '',
    internal_weight: internalWeight = 80,
    external_weight: externalWeight = 20,
    row_data: rowData = {},
  } = request.body;

  if (!departmentId || !programmeId || !semesterId || !courseId || !academicYear || !String(batch).trim()) {
    response.status(400).json({
      error: 'Department, Programme, Semester, Course, Academic Year, and Batch are required.',
    });
    return;
  }

  try {
    await ensureCoAttainmentCalculationTable();
    const result = await pool.query(
      `
        INSERT INTO co_attainment_calculation (
          department_id,
          programme_id,
          semester_id,
          course_id,
          academic_year,
          batch,
          internal_weight,
          external_weight,
          row_data,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (course_id, academic_year, batch)
        DO UPDATE SET
          department_id = EXCLUDED.department_id,
          programme_id = EXCLUDED.programme_id,
          semester_id = EXCLUDED.semester_id,
          internal_weight = EXCLUDED.internal_weight,
          external_weight = EXCLUDED.external_weight,
          row_data = EXCLUDED.row_data,
          updated_at = CURRENT_TIMESTAMP
        RETURNING calculation_id
      `,
      [
        Number(departmentId),
        Number(programmeId),
        Number(semesterId),
        Number(courseId),
        String(academicYear).trim(),
        String(batch).trim(),
        Number(internalWeight) || 0,
        Number(externalWeight) || 0,
        JSON.stringify(rowData || {}),
      ],
    );

    response.status(201).json({
      message: 'CO Attainment Calculation saved.',
      calculation_id: result.rows[0].calculation_id,
    });
  } catch (error) {
    response.status(400).json({
      error: 'Unable to save CO Attainment Calculation.',
      detail: error.message,
    });
  }
});

app.post('/api/co-po-attainment', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_id: courseId,
    academic_year: academicYear,
    row_data: rowData = {},
  } = request.body;

  if (!departmentId || !programmeId || !semesterId || !courseId || !String(academicYear || '').trim()) {
    response.status(400).json({
      error: 'Department, Programme, Semester, Course, and Academic Year are required.',
    });
    return;
  }

  try {
    await ensureCoPoAttainmentTable();
    const result = await pool.query(
      `
        INSERT INTO co_po_attainment (
          department_id, programme_id, semester_id, course_id, academic_year, row_data, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (course_id, academic_year)
        DO UPDATE SET
          department_id = EXCLUDED.department_id,
          programme_id = EXCLUDED.programme_id,
          semester_id = EXCLUDED.semester_id,
          row_data = EXCLUDED.row_data,
          updated_at = CURRENT_TIMESTAMP
        RETURNING co_po_attainment_id
      `,
      [
        Number(departmentId), Number(programmeId), Number(semesterId), Number(courseId),
        String(academicYear).trim(), JSON.stringify(rowData || {}),
      ],
    );

    response.status(201).json({
      message: 'CO-PO Attainment saved.',
      co_po_attainment_id: result.rows[0].co_po_attainment_id,
    });
  } catch (error) {
    response.status(400).json({ error: 'Unable to save CO-PO Attainment.', detail: error.message });
  }
});

app.post('/api/co-pso-attainment', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_id: courseId,
    academic_year: academicYear,
    row_data: rowData = {},
  } = request.body;

  if (!departmentId || !programmeId || !semesterId || !courseId || !String(academicYear || '').trim()) {
    response.status(400).json({
      error: 'Department, Programme, Semester, Course, and Academic Year are required.',
    });
    return;
  }

  try {
    await ensureCoPsoAttainmentTable();
    const result = await pool.query(
      `
        INSERT INTO co_pso_attainment (
          department_id, programme_id, semester_id, course_id, academic_year, row_data, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (course_id, academic_year)
        DO UPDATE SET
          department_id = EXCLUDED.department_id,
          programme_id = EXCLUDED.programme_id,
          semester_id = EXCLUDED.semester_id,
          row_data = EXCLUDED.row_data,
          updated_at = CURRENT_TIMESTAMP
        RETURNING co_pso_attainment_id
      `,
      [
        Number(departmentId), Number(programmeId), Number(semesterId), Number(courseId),
        String(academicYear).trim(), JSON.stringify(rowData || {}),
      ],
    );
    response.status(201).json({
      message: 'CO-PSO Attainment saved.',
      co_pso_attainment_id: result.rows[0].co_pso_attainment_id,
    });
  } catch (error) {
    response.status(400).json({ error: 'Unable to save CO-PSO Attainment.', detail: error.message });
  }
});

app.get('/api/university-question-mapping', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_id: courseId,
    academic_year: academicYear,
    exam_type: examType,
    exam_month: examMonth,
    exam_year: examYear,
  } = request.query;

  if (!departmentId || !programmeId || !semesterId || !courseId || !academicYear || !examType || !examMonth || !examYear) {
    response.status(400).json({
      error: 'Department, Programme, Semester, Course, Academic Year, Exam Type, Exam Month, and Exam Year are required.',
    });
    return;
  }

  try {
    await ensureUniversityQuestionMappingTable();
    const result = await pool.query(
      `
        SELECT
          question_mapping_id,
          department_id,
          programme_id,
          semester_id,
          course_id,
          academic_year,
          exam_type,
          exam_month,
          exam_year,
          total_marks,
          question_no,
          sub_question,
          co_code,
          carrying_mark
        FROM university_question_mapping
        WHERE department_id = $1
          AND programme_id = $2
          AND semester_id = $3
          AND course_id = $4
          AND academic_year = $5
          AND exam_type = $6
          AND exam_month = $7
          AND exam_year = $8
        ORDER BY question_mapping_id ASC
      `,
      [
        Number(departmentId),
        Number(programmeId),
        Number(semesterId),
        Number(courseId),
        String(academicYear),
        String(examType),
        String(examMonth),
        Number(examYear),
      ],
    );

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.get('/api/university-question-rubric', async (request, response) => {
  const courseId = request.query.course_id ? Number(request.query.course_id) : null;

  if (!Number.isInteger(courseId)) {
    response.status(400).json({ error: 'Course ID is required.' });
    return;
  }

  try {
    await ensureUniversityQuestionMappingTable();
    const result = await pool.query(
      `
        SELECT
          co_code,
          carrying_mark
        FROM university_question_mapping
        WHERE course_id = $1
        ORDER BY co_code ASC
      `,
      [courseId],
    );
    const summary = new Map();

    result.rows.forEach((row) => {
      const coCode = normalizeCourseOutcomeCode(row.co_code);
      const current = summary.get(coCode) || { co_code: coCode, count: 0, mark: 0 };
      current.count += 1;
      current.mark += Number(row.carrying_mark) || 0;
      summary.set(coCode, current);
    });

    const rows = [...summary.values()].sort((first, second) =>
      first.co_code.localeCompare(second.co_code, undefined, { numeric: true }),
    );
    const highestMark = Math.max(0, ...rows.map((row) => row.mark));
    const levelThreeMark = highestMark * (2 / 3);
    const levelTwoMark = highestMark * (1 / 3);

    response.json(
      rows.map((row) => ({
        ...row,
        rubric: highestMark <= 0 ? 0 : row.mark >= levelThreeMark ? 3 : row.mark >= levelTwoMark ? 2 : 1,
      })),
    );
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/university-question-mapping', async (request, response) => {
  const {
    department_id: departmentId,
    programme_id: programmeId,
    semester_id: semesterId,
    course_id: courseId,
    academic_year: academicYear,
    exam_type: examType,
    exam_month: examMonth,
    exam_year: examYear,
    total_marks: totalMarks,
    rows = [],
  } = request.body;

  if (
    !departmentId ||
    !programmeId ||
    !semesterId ||
    !courseId ||
    !academicYear ||
    !examType ||
    !examMonth ||
    !examYear ||
    !totalMarks ||
    !Array.isArray(rows) ||
    !rows.length
  ) {
    response.status(400).json({
      error: 'Question paper context and question rows are required.',
    });
    return;
  }

  const client = await pool.connect();

  try {
    await ensureUniversityQuestionMappingTable();
    await client.query('BEGIN');
    await client.query(
      `
        DELETE FROM university_question_mapping
        WHERE department_id = $1
          AND programme_id = $2
          AND semester_id = $3
          AND course_id = $4
          AND academic_year = $5
          AND exam_type = $6
          AND exam_month = $7
          AND exam_year = $8
      `,
      [
        Number(departmentId),
        Number(programmeId),
        Number(semesterId),
        Number(courseId),
        String(academicYear),
        String(examType),
        String(examMonth),
        Number(examYear),
      ],
    );

    for (const row of rows) {
      const questionNo = String(row.question_no || row.q_no || '').trim();
      const subQuestion = String(row.sub_question || row.sub_q || '').trim();
      const coCode = String(row.co_code || row.co || '').trim().toUpperCase();
      const carryingMark = Number(row.carrying_mark ?? row.mark);

      if (!questionNo || !subQuestion || !coCode || !Number.isFinite(carryingMark)) {
        throw new Error('Each question row needs Q.No, Sub Q., CO, and Carrying Mark.');
      }

      await client.query(
        `
          INSERT INTO university_question_mapping (
            department_id,
            programme_id,
            semester_id,
            course_id,
            academic_year,
            exam_type,
            exam_month,
            exam_year,
            total_marks,
            question_no,
            sub_question,
            co_code,
            carrying_mark,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
        `,
        [
          Number(departmentId),
          Number(programmeId),
          Number(semesterId),
          Number(courseId),
          String(academicYear),
          String(examType),
          String(examMonth),
          Number(examYear),
          Number(totalMarks),
          questionNo,
          subQuestion,
          coCode,
          carryingMark,
        ],
      );
    }

    await client.query('COMMIT');
    response.status(201).json({
      message: `${rows.length} university question mapping rows saved.`,
      count: rows.length,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    response.status(400).json({
      error: 'Unable to save university question mapping.',
      detail: error.message,
    });
  } finally {
    client.release();
  }
});

app.get('/api/assessment-attainment-levels', async (request, response) => {
  const academicYear = request.query.academic_year || '2024-25';
  const assessmentCategory =
    request.query.assessment_category || 'Internal & External Assessment';
  const allYears = request.query.all_years === 'true';

  try {
    await ensureAssessmentAttainmentLevelsTable();
    const result = await pool.query(
      `
        SELECT
          level_id,
          academic_year,
          assessment_category,
          COALESCE(level_number, level_no) AS level_number,
          code,
          level_name,
          min_percentage,
          max_percentage,
          condition_text,
          remarks
        FROM assessment_attainment_levels
        WHERE assessment_category = $1
          ${allYears ? '' : 'AND academic_year = $2'}
        ORDER BY academic_year ASC, level_number ASC
      `,
      allYears ? [assessmentCategory] : [assessmentCategory, academicYear],
    );

    response.json(result.rows);
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.post('/api/assessment-attainment-levels', async (request, response) => {
  const {
    academic_year: academicYear,
    assessment_category: assessmentCategory,
    remarks = '',
    levels = [],
  } = request.body;

  if (!academicYear || !assessmentCategory || !Array.isArray(levels) || !levels.length) {
    response.status(400).json({
      error: 'Academic Year, Assessment Category, and Levels are required.',
    });
    return;
  }

  const client = await pool.connect();

  try {
    await ensureAssessmentAttainmentLevelsTable();
    await client.query('BEGIN');
    await client.query(
      `
        DELETE FROM assessment_attainment_levels
        WHERE academic_year = $1
          AND assessment_category = $2
      `,
      [academicYear, assessmentCategory],
    );

    for (const level of levels) {
      await client.query(
        `
          INSERT INTO assessment_attainment_levels (
            academic_year,
            assessment_category,
            level_no,
            level_number,
            code,
            level_name,
            min_percentage,
            max_percentage,
            condition_text,
            remarks,
            updated_at
          )
          VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
        `,
        [
          academicYear,
          assessmentCategory,
          Number(level.level_number),
          level.code?.trim() || '',
          level.level_name?.trim() || '',
          Number(level.min_percentage),
          Number(level.max_percentage),
          level.condition_text?.trim() || '',
          remarks.trim(),
        ],
      );
    }

    await client.query('COMMIT');
    response.status(201).json({ saved: levels.length });
  } catch (error) {
    await client.query('ROLLBACK');
    sendDatabaseError(response, error);
  } finally {
    client.release();
  }
});

app.delete('/api/assessment-attainment-levels/:levelId', async (request, response) => {
  try {
    await ensureAssessmentAttainmentLevelsTable();
    const result = await pool.query(
      'DELETE FROM assessment_attainment_levels WHERE level_id = $1 RETURNING level_id',
      [request.params.levelId],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Assessment level not found.' });
      return;
    }

    response.status(204).send();
  } catch (error) {
    sendDatabaseError(response, error);
  }
});

app.use('/api', (_request, response) => {
  response.status(404).json({
    error: 'API endpoint not found.',
  });
});

app.listen(port, () => {
  console.log(`Express server running at http://localhost:${port}`);
});
