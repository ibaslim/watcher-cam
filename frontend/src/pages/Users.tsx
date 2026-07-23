import { useEffect, useState } from "react";
import {
  AppUser,
  UserCreateInput,
  createUser,
  deleteUser,
  fetchUsers,
  updateUser,
} from "../lib/api";

const EMPTY: UserCreateInput = {
  full_name: "",
  username: "",
  password: "",
  role: "operator",
};

export function Users() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [form, setForm] = useState<UserCreateInput>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => fetchUsers().then(setUsers).catch(() => setUsers([]));

  useEffect(() => {
    reload();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    try {
      await createUser(form);
      setForm(EMPTY);
      setAdding(false);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;

    setBusy(true);
    setErr(null);

    try {
      await updateUser(editing.id, {
        full_name: editing.full_name,
        role: editing.role,
        is_active: editing.is_active,
        password: editPassword,
      });

      setEditing(null);
      setEditPassword("");
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: AppUser) => {
    if (!confirm(`Delete user "${u.username}"?`)) return;

    setBusy(true);
    setErr(null);

    try {
      await deleteUser(u.id);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <div className="page-inner">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="page-title !m-0">Users</h2>
          <button className="btn primary" onClick={() => setAdding(true)}>
            + Add User
          </button>
        </div>
        <p className="page-sub">
          Create administrator and operator accounts. Operators can view dashboard and reports only.
        </p>

        {err && (
          <div className="alert alert-error mb-4">
            {err}
          </div>
        )}

        <div className="user-card">
          <table className="user-table">
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th className="w-44"></th>
              </tr>
            </thead>

            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name || "-"}</td>
                  <td className="font-mono text-sm">{u.username}</td>
                  <td>
                    <span className={`badge ${u.role === "administrator" ? "badge-info" : "badge-muted"}`}>
                      {u.role}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${u.is_active ? "badge-ok" : "badge-danger"}`}>
                      {u.is_active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn" onClick={() => setEditing(u)}>
                        Edit
                      </button>
                      <button className="btn btn-danger" onClick={() => remove(u)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-theme-muted">No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Add User Modal */}
        {adding && (
          <AddUserModal
            form={form}
            busy={busy}
            onChange={setForm}
            onSubmit={create}
            onCancel={() => {
              setAdding(false);
              setForm(EMPTY);
              setErr(null);
            }}
          />
        )}

        {/* Edit User Modal */}
        {editing && (
          <div className="modal-overlay" onClick={() => setEditing(null)}>
            <div className="modal user-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Edit User</h3>

              <div className="space-y-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-theme-muted">Full Name</label>
                  <input
                    className="input"
                    value={editing.full_name}
                    onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-theme-muted">Role</label>
                  <select
                    className="input"
                    value={editing.role}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        role: e.target.value as "administrator" | "operator",
                      })
                    }
                  >
                    <option value="operator">Operator</option>
                    <option value="administrator">Administrator</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-theme-muted">New Password</label>
                  <input
                    className="input"
                    type="password"
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    placeholder="Leave blank to keep current password"
                  />
                </div>

                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={editing.is_active}
                    onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                  />
                  Active
                </label>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button className="btn" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="btn primary" onClick={saveEdit} disabled={busy}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function AddUserModal({
  form,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: UserCreateInput;
  busy: boolean;
  onChange: (form: UserCreateInput) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form
        className="modal max-w-[560px]"
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Add User</h3>

        <div className="form-grid">
          <label>Full Name</label>
          <input
            className="input"
            placeholder="Full name"
            value={form.full_name}
            onChange={(e) => onChange({ ...form, full_name: e.target.value })}
          />

          <label>Username</label>
          <input
            className="input"
            placeholder="Username"
            value={form.username}
            onChange={(e) => onChange({ ...form, username: e.target.value })}
            required
          />

          <label>Password</label>
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={(e) => onChange({ ...form, password: e.target.value })}
            required
          />

          <label>Role</label>
          <select
            className="input"
            value={form.role}
            onChange={(e) =>
              onChange({ ...form, role: e.target.value as "administrator" | "operator" })
            }
          >
            <option value="operator">Operator</option>
            <option value="administrator">Administrator</option>
          </select>
        </div>

        <div className="mt-7 flex gap-2.5 justify-end">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Saving..." : "Add User"}
          </button>
        </div>
      </form>
    </div>
  );
}
