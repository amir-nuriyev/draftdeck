import ShareResolveView from "@/app/components/share-resolve-view";

type SharePageProps = {
  params: Promise<{ token: string }>;
};

export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params;
  return <ShareResolveView token={token} />;
}
