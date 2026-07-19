import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import RoleGuard from "#/components/RoleGuard";
import PageHeader from "#/components/ui/PageHeader";
import { usePageTitle } from "#/hooks/usePageTitle";
import DataTable from "#/components/ui/DataTable";
import { getCategories } from "#/lib/server/categories";
import type { Column } from "#/components/ui/DataTable";
import { Badge } from "#/components/ui/badge";
import { ArrowRight } from "lucide-react";

interface CategoryRow {
  code: string;
  name: string;
  recipeCount: number;
}

const columns: Column<CategoryRow>[] = [
  {
    key: "name",
    header: "Kategori",
    sortable: true,
    render: (r) => <span className="font-medium capitalize">{r.name}</span>,
  },
  {
    key: "recipeCount",
    header: "Menu Terkait",
    width: "w-28",
    align: "center",
    sortable: true,
    render: (r) => <Badge variant="outline">{r.recipeCount}</Badge>,
  },
  {
    key: "code",
    header: "",
    width: "w-12",
    render: (r) => (
      <Link
        to="/categories/$categoryId"
        params={{ categoryId: r.code }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <ArrowRight className="h-4 w-4" />
      </Link>
    ),
  },
];

export const Route = createFileRoute("/_layout/categories/")({
  component: CategoriesPage,
  loader: async () => {
    const cats = await getCategories({});
    return { categories: cats };
  },
});

function CategoriesPage() {
  const { categories: initial } = Route.useLoaderData();

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories({}),
    initialData: initial,
  });

  usePageTitle("Kategori Menu", "Kelola kategori menu & resep");

  return (
    <RoleGuard allowedRoles={["super_admin", "admin_pusat"]}>
      <PageHeader />

      <DataTable columns={columns} data={categories} keyExtractor={(r) => r.code} />
    </RoleGuard>
  );
}
