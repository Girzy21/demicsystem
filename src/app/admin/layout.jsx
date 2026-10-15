// Halaman admin tidak boleh diindeks mesin pencari.
export const metadata = {
  title: "Panel Admin · w3study",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }) {
  return children;
}
