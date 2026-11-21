import { EditorSkeleton } from "@/components/EditorSkeleton";

/** Shown between route changes into the master resume: the editor's chrome, with the loader over the blank page. */
export default function Loading() {
  return <EditorSkeleton kind="master" />;
}
