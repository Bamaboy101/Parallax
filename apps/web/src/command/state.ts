import { create } from 'zustand';

/** Whether the command bar is open. */
export const useCommandBar = create<{ open: boolean }>()(() => ({ open: false }));

export function openCommandBar(): void {
  useCommandBar.setState({ open: true });
}

export function closeCommandBar(): void {
  useCommandBar.setState({ open: false });
}
