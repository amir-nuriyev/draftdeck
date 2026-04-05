import DraftCockpit from "@/app/components/draft-cockpit";

type DraftPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function DraftPage({ params }: DraftPageProps) {
  const { id } = await params;
  return <DraftCockpit draftId={Number(id)} />;
}
