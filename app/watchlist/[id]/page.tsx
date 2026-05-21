import { WatchCompanyPage } from "./_components/watch-company-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WatchCompanyPage id={id} />;
}
