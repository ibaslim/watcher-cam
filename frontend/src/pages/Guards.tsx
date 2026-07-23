import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Guard,
  PostConfig,
  createGuard,
  deleteGuard,
  fetchCameras,
  fetchGuards,
  fetchPost,
  savePost,
  uploadGuardPhoto,
} from "../lib/api";

const MAX_GUARD_PHOTOS = 10;
const MAX_GUARD_PHOTO_BYTES = 10 * 1024 * 1024;

type PostOption = {
  camera: Camera;
  post: PostConfig;
  label: string;
};

export function Guards() {
  const [guards, setGuards] = useState<Guard[]>([]);
  const [posts, setPosts] = useState<PostOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState<number | "create" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reload = () => fetchGuards().then(setGuards).catch(() => setGuards([]));

  const reloadPosts = async () => {
    try {
      const cameras = await fetchCameras();
      const loadedPosts = await Promise.all(
        cameras.map(async (camera) => {
          const post = await fetchPost(camera.id);
          return {
            camera,
            post,
            label: post.post_name.trim() || camera.name || camera.id,
          };
        }),
      );
      setPosts(loadedPosts.sort((a, b) => a.label.localeCompare(b.label)));
    } catch {
      setPosts([]);
    }
  };

  useEffect(() => {
    reload();
    reloadPosts();
  }, []);

  const onCreate = async (name: string, assignedCameraId: string, files: File[]) => {
    setBusy("create");
    try {
      const guard = await createGuard(name);

      for (const file of files) {
        await uploadGuardPhoto(guard.id, file);
      }

      const selectedPost = posts.find((post) => post.camera.id === assignedCameraId);
      if (selectedPost) {
        const { camera_id: _cameraId, ...body } = selectedPost.post;
        await savePost(selectedPost.camera.id, {
          ...body,
          assigned_guard_id: guard.id,
          is_guarded: true,
        });
        await reloadPosts();
      }

      setModalOpen(false);
      await reload();
    } catch (err) {
      setToast(`create failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (g: Guard) => {
    if (!confirm(`Delete guard "${g.name}" and all enrolled photos?`)) return;
    setBusy(g.id);
    try {
      await deleteGuard(g.id);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="page">
      <div className="page-inner">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="page-title !m-0">Enrolled guards</h2>
          <button className="btn primary" data-tour="add-guard" onClick={() => setModalOpen(true)}>
            + Add Guard
          </button>
        </div>
        <p className="page-sub">
          Upload 5-10 clear photos per guard: front-facing, well-lit, with the face filling most of the
          frame. More photos from different angles improves recognition accuracy in the field.
        </p>

        {toast && (
          <div className="alert alert-warn mb-4">
            <span>{toast}</span>
            <button className="btn-link ml-2" onClick={() => setToast(null)}>
              dismiss
            </button>
          </div>
        )}

        <div className="space-y-3">
          {guards.length === 0 && <div className="empty">No guards enrolled yet.</div>}
          {guards.map((g) => (
            <GuardRow key={g.id} guard={g} busy={busy === g.id} onDelete={() => onDelete(g)} onChanged={reload} />
          ))}
        </div>

        {modalOpen && (
          <AddGuardModal
            busy={busy === "create"}
            posts={posts}
            onSubmit={onCreate}
            onCancel={() => setModalOpen(false)}
          />
        )}
      </div>
    </main>
  );
}

function AddGuardModal({
  busy,
  posts,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  posts: PostOption[];
  onSubmit: (name: string, assignedCameraId: string, files: File[]) => void;
  onCancel: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [assignedCameraId, setAssignedCameraId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const chooseFiles = (selected: FileList | null) => {
    setError(null);
    if (!selected) return;

    const next = Array.from(selected);
    const problem = validateGuardPhotos(next, 0);
    if (problem) {
      setError(problem);
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setFiles(next);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const problem = validateGuardPhotos(files, 0);
    if (problem) {
      setError(problem);
      return;
    }

    onSubmit(trimmedName, assignedCameraId, files);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="modal w-[700px] max-w-[95vw]"
      >
        <h3>Add Guard</h3>

        <div className="form-grid">
          <label>Guard Name</label>
          <input
            className="input"
            type="text"
            value={name}
            required
            placeholder="e.g. Mahad"
            onChange={(e) => setName(e.target.value)}
          />

          <label>Assigned to</label>
          <select className="input" value={assignedCameraId} onChange={(e) => setAssignedCameraId(e.target.value)}>
            <option value="">No post assigned</option>
            {posts.map((post) => (
              <option key={post.camera.id} value={post.camera.id}>
                {post.label}
              </option>
            ))}
          </select>

          <label>Upload Photos</label>
          <div className="pt-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => chooseFiles(e.target.files)}
            />
            <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
              Choose photos
            </button>
            <div className="mt-3 text-theme-muted text-xs">
              {files.length > 0 ? `${files.length} selected` : "Up to 10 photos, max 10 MB each."}
            </div>
          </div>
        </div>

        {error && (
          <div className="alert alert-error mt-3">
            {error}
          </div>
        )}

        <div className="mt-7 flex gap-2.5 justify-end">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            {busy ? "Adding..." : "Add Guard"}
          </button>
        </div>
      </form>
    </div>
  );
}

function GuardRow({
  guard,
  busy,
  onDelete,
  onChanged,
}: {
  guard: Guard;
  busy: boolean;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const selected = Array.from(files);
    const problem = validateGuardPhotos(selected, guard.photo_count);
    if (problem) {
      setUploadError(problem);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      for (const f of selected) {
        await uploadGuardPhoto(guard.id, f);
      }
      await onChanged();
    } catch (err) {
      setUploadError((err as Error).message || "upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="card p-4 grid grid-cols-[1fr_auto] items-center gap-3">
      <div>
        <div className="font-semibold text-theme">{guard.name}</div>
        <div className="text-xs text-theme-muted mt-1">
          {guard.photo_count} photo{guard.photo_count === 1 ? "" : "s"} enrolled —{" "}
          {guard.photo_count < 3 ? (
            <span className="text-red-400">needs more photos for reliable match</span>
          ) : (
            <span className="text-emerald-400">ready</span>
          )}
        </div>
        {uploadError && (
          <div className="text-red-400 text-xs mt-1.5">{uploadError}</div>
        )}
      </div>
      <div className="flex gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        <button
          className="btn"
          data-tour="guard-photos"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || guard.photo_count >= MAX_GUARD_PHOTOS}
        >
          {uploading ? "Uploading..." : "Add photos"}
        </button>
        <button className="btn btn-danger" onClick={onDelete} disabled={busy}>
          Delete
        </button>
      </div>
    </div>
  );
}

function validateGuardPhotos(files: File[], existingCount: number): string | null {
  if (files.length + existingCount > MAX_GUARD_PHOTOS) {
    return `A guard can have maximum ${MAX_GUARD_PHOTOS} photos.`;
  }

  const oversized = files.find((file) => file.size > MAX_GUARD_PHOTO_BYTES);
  if (oversized) {
    return `"${oversized.name}" is larger than 10 MB.`;
  }

  return null;
}
