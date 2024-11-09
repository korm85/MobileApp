// Get a reference to the streak element
const streakElement = document.getElementById('streak');

// Function to mark a workout and update the streak
function markWorkout() {
  // Get the current date
  const today = new Date();
  const todayString = today.toISOString().slice(0, 10); // YYYY-MM-DD

  // Check if the workout is already marked for today
  const workouts = JSON.parse(localStorage.getItem('workouts')) || [];
  const isWorkoutMarked = workouts.includes(todayString);

  if (!isWorkoutMarked) {
    workouts.push(todayString);
    localStorage.setItem('workouts', JSON.stringify(workouts));

    // Update the streak display
    streakElement.textContent = `You've worked out for ${workouts.length} days in a row! Keep up the great work!`;
  }
}
