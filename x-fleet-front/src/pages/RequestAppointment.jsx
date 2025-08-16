import { useState } from 'react';

export default function RequestAppointment() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    jobType: 'Repair',
    estValue: '',
    territory: 'EAST',
    date: '' 
  });

  const [suggestions, setSuggestions] = useState([]);
  const [selectedTime, setSelectedTime] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false); // ✅ Added
  const [error, setError] = useState('');        // ✅ Added

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
  e.preventDefault();
  setLoading(true);
  setError('');
  setSuggestions([]);
  try {
    const res = await fetch('http://localhost:8080/api/suggest-times', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: form.date,                 // required
        timezone: 'America/New_York',    // recommended
        address: form.address,
        jobType: form.jobType,
        estValue: form.estValue,
        territory: form.territory,
      })
    });
    const data = await res.json();
    if (res.ok && data.ok && data.suggestions) {
      setSuggestions(data.suggestions);
    } else {
      setError(data.error || 'No suggestions available');
    }
  } catch (err) {
    console.error('[suggest-times error]', err);
    setError('Failed to fetch suggestions');
  } finally {
    setLoading(false);
  }
};

  const confirmAppointment = async () => {
  if (!selectedTime) return;
  try {
    const payload = {
      contact: {
        name: form.name,
        email: form.email,
        phone: form.phone
      },
      address: form.address,
      jobType: form.jobType,
      estValue: form.estValue,
      territory: form.territory,
      startTime: new Date(selectedTime.start).toISOString(), // ✅ UTC ISO
      endTime: new Date(selectedTime.end).toISOString()      // ✅ UTC ISO
    };

    const res = await fetch('http://localhost:8080/api/create-appointment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.ok) {
      setConfirmed(true);
    } else {
      console.error('[Confirm Error]', data);
    }
  } catch (err) {
    console.error('Error confirming appointment:', err);
  }
};

  return (
    <div style={{ maxWidth: 500, margin: '0 auto' }}>
      <h2>Request an Appointment</h2>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p>Loading available times...</p>}

      {!suggestions.length && !confirmed && (
       <form onSubmit={handleSubmit} className="space-y-4">
  <input
    type="text"
    name="name"
    value={form.name}
    onChange={handleChange}
    placeholder="Full Name"
    className="w-full p-2 rounded bg-gray-700 text-white"
  />

  <input
    type="email"
    name="email"
    value={form.email}
    onChange={handleChange}
    placeholder="Email"
    className="w-full p-2 rounded bg-gray-700 text-white"
  />

  <input
    type="tel"
    name="phone"
    value={form.phone}
    onChange={handleChange}
    placeholder="Phone"
    className="w-full p-2 rounded bg-gray-700 text-white"
  />

  <input
    type="text"
    name="address"
    value={form.address}
    onChange={handleChange}
    placeholder="Address"
    className="w-full p-2 rounded bg-gray-700 text-white"
  />

  <select
    name="jobType"
    value={form.jobType}
    onChange={handleChange}
    className="w-full p-2 rounded bg-gray-700 text-white"
  >
    <option value="Repair">Repair</option>
    <option value="Install">Install</option>
  </select>

  <input
    type="text"
    name="estValue"
    value={form.estValue}
    onChange={handleChange}
    placeholder="Estimated Value"
    className="w-full p-2 rounded bg-gray-700 text-white"
  />

  {/* 👇 New date input goes here */}
  <input
    type="date"
    name="date"
    value={form.date}
    onChange={handleChange}
    required
    className="w-full p-2 rounded bg-gray-700 text-white"
  />

  <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded">
    Check Available Times
  </button>
</form>
      )}

      {suggestions.length > 0 && !confirmed && (
        <div>
          <h3>Available Times</h3>
          {suggestions.map((s, i) => (
            <button
              key={i}
              style={{
                display: 'block',
                margin: '5px 0',
                padding: '10px',
                background: selectedTime === s ? '#007bff' : '#eee',
                color: selectedTime === s ? '#fff' : '#000'
              }}
              onClick={() => setSelectedTime(s)}
            >
              {new Date(s.start).toLocaleString()} — {new Date(s.end).toLocaleTimeString()}  
              <br />
              Tech: {s.tech}
            </button>
          ))}
          <button
            onClick={confirmAppointment}
            disabled={!selectedTime}
            style={{ marginTop: '10px' }}
          >
            Confirm Appointment
          </button>
        </div>
      )}

      {confirmed && (
        <div>
          <h3>✅ Appointment Confirmed!</h3>
          <p>We’ve booked your appointment for {new Date(selectedTime.start).toLocaleString()}.</p>
        </div>
      )}
    </div>
  );
}