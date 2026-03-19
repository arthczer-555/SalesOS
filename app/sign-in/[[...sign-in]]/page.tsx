import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{ background: "#f9f9f9" }}
    >
      <SignIn />
    </div>
  );
}
