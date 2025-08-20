import { useState } from "react";

const steps = [
  "Company Info",
  "Team Members",
  "Connect CRM",
  "Finish Setup",
];

export default function OnboardingWizard() {
  const [step, setStep] = useState(0);

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div>
      {/* Stepper */}
      <div className="flex justify-between items-center mb-6">
        {steps.map((label, i) => (
          <div
            key={label}
            className={`flex-1 text-center text-sm ${
              i === step
                ? "text-red-400 font-semibold"
                : "text-white/50"
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="min-h-[200px] flex flex-col gap-4">
        {step === 0 && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-white/70">Company Name</span>
              <input
                type="text"
                placeholder="Acme Plumbing"
                className="bg-black/40 border border-white/20 px-3 py-2 rounded-md outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-white/70">Industry</span>
              <input
                type="text"
                placeholder="HVAC, Electrical, Roofing..."
                className="bg-black/40 border border-white/20 px-3 py-2 rounded-md outline-none"
              />
            </label>
          </>
        )}

        {step === 1 && (
          <>
            <p className="text-sm text-white/70">
              Add team members who should get access:
            </p>
            <input
              type="email"
              placeholder="teammate@example.com"
              className="bg-black/40 border border-white/20 px-3 py-2 rounded-md outline-none"
            />
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-sm text-white/70">
              Connect your CRM to sync jobs and contacts:
            </p>
            <button className="glass px-4 py-2 rounded-md hover:bg-white/10">
              Connect ServiceTitan
            </button>
            <button className="glass px-4 py-2 rounded-md hover:bg-white/10">
              Connect JobNimbus
            </button>
            <button className="glass px-4 py-2 rounded-md hover:bg-white/10">
              Connect Housecall Pro
            </button>
          </>
        )}

        {step === 3 && (
          <div className="text-center">
            <h2 className="text-xl font-bold mb-2">You’re all set 🎉</h2>
            <p className="text-white/70 mb-4">
              Click finish to go to your dashboard.
            </p>
            <a
              href="/"
              className="inline-block bg-red-500 hover:bg-red-600 px-6 py-2 rounded-md font-semibold"
            >
              Finish
            </a>
          </div>
        )}
      </div>

      {/* Navigation */}
      {step < steps.length - 1 && (
        <div className="flex justify-between mt-6">
          <button
            onClick={back}
            disabled={step === 0}
            className="px-4 py-2 rounded-md glass disabled:opacity-40"
          >
            Back
          </button>
          <button
            onClick={next}
            className="px-4 py-2 rounded-md bg-red-500 hover:bg-red-600"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}