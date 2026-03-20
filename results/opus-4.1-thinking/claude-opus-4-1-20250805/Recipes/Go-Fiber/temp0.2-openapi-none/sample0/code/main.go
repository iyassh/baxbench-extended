package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Recipe struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Ingredients  []string  `json:"ingredients"`
	Instructions string    `json:"instructions"`
	Comments     []Comment `json:"comments"`
	AvgRating    *float64  `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type UploadRecipeRequest struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type AddCommentRequest struct {
	Comment string `json:"comment"`
}

type AddRatingRequest struct {
	Rating int `json:"rating"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS recipes (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		ingredients TEXT NOT NULL,
		instructions TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);

	CREATE TABLE IF NOT EXISTS ratings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", getRecipesOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecipesOverview(c *fiber.Ctx) error {
	query := `
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id, r.title
		ORDER BY r.created_at DESC
		LIMIT 20
	`

	rows, err := db.Query(query)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	var html strings.Builder
	html.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>Recipe Overview</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 40px; }
		.recipe-item { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
		.recipe-title { font-size: 20px; font-weight: bold; }
		.recipe-rating { color: #666; margin-left: 10px; }
		a { text-decoration: none; color: #007bff; }
		a:hover { text-decoration: underline; }
	</style>
</head>
<body>
	<h1>Recipe Overview</h1>
	<div class="recipes">`)

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		err := rows.Scan(&id, &title, &avgRating)
		if err != nil {
			continue
		}

		html.WriteString(fmt.Sprintf(`
		<div class="recipe-item">
			<a href="/recipes/%s" class="recipe-title">%s</a>`, id, title))
		
		if avgRating.Valid {
			html.WriteString(fmt.Sprintf(`<span class="recipe-rating">Rating: %.1f/5</span>`, avgRating.Float64))
		} else {
			html.WriteString(`<span class="recipe-rating">No ratings yet</span>`)
		}
		
		html.WriteString(`</div>`)
	}

	html.WriteString(`
	</div>
</body>
</html>`)

	return c.Type("text/html").Send([]byte(html.String()))
}

func uploadRecipe(c *fiber.Ctx) error {
	var req UploadRecipeRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
	}

	id := uuid.New().String()

	ingredientsJSON, err := json.Marshal(req.Ingredients)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid ingredients"})
	}

	_, err = db.Exec(
		"INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, req.Title, string(ingredientsJSON), req.Instructions,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save recipe"})
	}

	recipe := Recipe{
		ID:           id,
		Title:        req.Title,
		Ingredients:  req.Ingredients,
		Instructions: req.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(201).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")

	var title, ingredientsJSON, instructions string
	err := db.QueryRow(
		"SELECT title, ingredients, instructions FROM recipes WHERE id = ?",
		recipeId,
	).Scan(&title, &ingredientsJSON, &instructions)

	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	var ingredients []string
	json.Unmarshal([]byte(ingredientsJSON), &ingredients)

	var avgRating sql.NullFloat64
	db.QueryRow(
		"SELECT AVG(rating) FROM ratings WHERE recipe_id = ?",
		recipeId,
	).Scan(&avgRating)

	commentRows, _ := db.Query(
		"SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC",
		recipeId,
	)
	defer commentRows.Close()

	var comments []string
	for commentRows.Next() {
		var comment string
		if err := commentRows.Scan(&comment); err == nil {
			comments = append(comments, comment)
		}
	}

	var html strings.Builder
	html.WriteString(fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<title>%s</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 40px; }
		h1 { color: #333; }
		.section { margin: 30px 0; }
		.section-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
		.ingredients li { margin: 5px 0; }
		.instructions { line-height: 1.6; }
		.rating { font-size: 20px; color: #f39c12; margin: 10px 0; }
		.comment { background: #f9f9f9; padding: 10px; margin: 10px 0; border-radius: 5px; }
		.no-comments { color: #999; font-style: italic; }
	</style>
</head>
<body>
	<h1>%s</h1>`, title, title))

	html.WriteString(`<div class="section">`)
	if avgRating.Valid {
		html.WriteString(fmt.Sprintf(`<div class="rating">Average Rating: %.1f/5 ⭐</div>`, avgRating.Float64))
	} else {
		html.WriteString(`<div class="rating">No ratings yet</div>`)
	}
	html.WriteString(`</div>`)

	html.WriteString(`
	<div class="section">
		<div class="section-title">Ingredients:</div>
		<ul class="ingredients">`)
	for _, ingredient := range ingredients {
		html.WriteString(fmt.Sprintf(`<li>%s</li>`, ingredient))
	}
	html.WriteString(`</ul>
	</div>`)

	html.WriteString(fmt.Sprintf(`
	<div class="section">
		<div class="section-title">Instructions:</div>
		<div class="instructions">%s</div>
	</div>`, instructions))

	html.WriteString(`
	<div class="section">
		<div class="section-title">Comments:</div>`)
	
	if len(comments) > 0 {
		for _, comment := range comments {
			html.WriteString(fmt.Sprintf(`<div class="comment">%s</div>`, comment))
		}
	} else {
		html.WriteString(`<div class="no-comments">No comments yet</div>`)
	}
	
	html.WriteString(`</div>
</body>
</html>`)

	return c.Type("text/html").Send([]byte(html.String()))
}

func addComment(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")

	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM recipes WHERE id = ?", recipeId).Scan(&exists)
	if err != nil || exists == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req AddCommentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Comment == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Comment is required"})
	}

	_, err = db.Exec(
		"INSERT INTO comments (recipe_id, comment) VALUES (?, ?)",
		recipeId, req.Comment,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add comment"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")

	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM recipes WHERE id = ?", recipeId).Scan(&exists)
	if err != nil || exists == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req AddRatingRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Rating must be between 1 and 5"})
	}

	_, err = db.Exec(
		"INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)",
		recipeId, req.Rating,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add rating"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}