import OnboardingWizard from "../components/OnboardingWizard";

export default function Onboarding() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-black to-gray-900 text-white">
      <div className="w-full max-w-2xl glass rounded-lg p-6 shadow-lg">
        <h1 className="text-2xl font-bold mb-4 text-center">
          Welcome to Nonstop Automation 🎉
        </h1>
        <p className="text-center text-white/70 mb-6">
          Let’s get your company set up in just a few easy steps.
        </p>
        <OnboardingWizard />
      </div>
    </div>
  );
}