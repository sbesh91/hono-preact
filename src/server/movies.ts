export async function getMovies() {
  const url =
    "https://api.themoviedb.org/3/discover/movie?include_adult=false&include_video=false&language=en-US&page=1&sort_by=popularity.desc";
  const options = {
    method: "GET",
    headers: {
      accept: "application/json",
      Authorization: process.env.API_KEY ?? "",
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
      Authorization: process.env.API_KEY ?? "",
    },
  };

  try {
    const res = await fetch(url, options);
    return await res.json();
  } catch (err) {
    return err;
  }
}
