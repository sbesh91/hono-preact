export async function getMovies() {
  const url =
    "https://api.themoviedb.org/3/discover/movie?include_adult=false&include_video=false&language=en-US&page=1&sort_by=popularity.desc";
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      Authorization:
        "Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI5OGZmNDZmMmM0NzY3ODk5ODhkZTYyOWZlYmFmZTAwMCIsIm5iZiI6MTczOTExNTI2Ni45MjQsInN1YiI6IjY3YThjYjAyNWZhNDJkN2U3NmYxM2ZmYSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.3jv7QUpRoHPIKH0clcm5FL13FSV1l1xUoy4Wt5uqE3o",
    },
  };

  try {
    const res = await fetch(url, options);
    return await res.json();
  } catch (err) {
    return err;
  }
}

export async function getMovie(id: string) {
  const url = `https://api.themoviedb.org/3/movie/${id}`;
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      Authorization:
        "Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI5OGZmNDZmMmM0NzY3ODk5ODhkZTYyOWZlYmFmZTAwMCIsIm5iZiI6MTczOTExNTI2Ni45MjQsInN1YiI6IjY3YThjYjAyNWZhNDJkN2U3NmYxM2ZmYSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.3jv7QUpRoHPIKH0clcm5FL13FSV1l1xUoy4Wt5uqE3o",
    },
  };

  try {
    const res = await fetch(url, options);
    return await res.json();
  } catch (err) {
    return err;
  }
}
