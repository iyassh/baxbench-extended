package main

import (
	"database/sql"
	"fmt"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Recipe struct {
	ID           string     `json:"id"`
	Title        string     `json:"title"`
	Ingredients  []string   `json:"ingredients"`
	Instructions string     `json:"instructions"`
	Comments     []Comment  `json:"comments"`
	AvgRating    *float64   `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type RecipeUploadRequest struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type CommentRequest struct {
	Comment string `json:"comment"`
}

type RatingRequest struct {
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
		instructions TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);

	CREATE TABLE IF NOT EXISTS ratings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
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
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id, r.title
		ORDER BY avg_rating DESC, r.rowid DESC
		LIMIT 20
	`)
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
		body { font-family: Arial, sans-serif; margin: 20px; }
		h1 { color: #333; }
		.recipe-list { list-style: none; padding: 0; }
		.recipe-item { margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
		.recipe-link { text-decoration: none; color: #0066cc; font-size: 18px; }
		.rating { color: #666; margin-left: 10px; }
	</style>
</head>
<body>
	<h1>Recipe Overview</h1>
	<ul class="recipe-list">`)

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		err := rows.Scan(&id, &title, &avgRating)
		if err != nil {
			continue
		}
		
		ratingStr := "No ratings yet"
		if avgRating.Valid {
			ratingStr = fmt.Sprintf("Rating: %.1f/5", avgRating.Float64)
		}
		
		html.WriteString(fmt.Sprintf(`
		<li class="recipe-item">
			<a href="/recipes/%s" class="recipe-link">%s</a>
			<span class="rating">%s</span>
		</li>`, id, title, ratingStr))
	}

	html.WriteString(`
	</ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func uploadRecipe(c *fiber.Ctx) error {
	var req RecipeUploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	id := uuid.New().String()
	ingredientsStr := strings.Join(req.Ingredients, "|")

	_, err := db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, req.Title, ingredientsStr, req.Instructions)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create recipe"})
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

	var title, ingredientsStr, instructions string
	err := db.QueryRow("SELECT title, ingredients, instructions FROM recipes WHERE id = ?", recipeId).
		Scan(&title, &ingredientsStr, &instructions)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	ingredients := strings.Split(ingredientsStr, "|")

	rows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeId)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	var comments []string
	for rows.Next() {
		var comment string
		if err := rows.Scan(&comment); err == nil {
			comments = append(comments, comment)
		}
	}

	var avgRating sql.NullFloat64
	err = db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeId).Scan(&avgRating)
	if err != nil && err != sql.ErrNoRows {
		return c.Status(500).SendString("Server error")
	}

	ratingStr := "No ratings yet"
	if avgRating.Valid {
		ratingStr = fmt.Sprintf("%.1f/5", avgRating.Float64)
	}

	var html strings.Builder
	html.WriteString(fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
	<title>%s</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
		h1 { color: #333; }
		h2 { color: #666; margin-top: 20px; }
		.rating { background: #f0f0f0; padding: 10px; border-radius: 5px; margin: 10px 0; }
		.ingredients { list-style-type: disc; margin-left: 20px; }
		.instructions { background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 10px 0; }
		.comments { margin-top: 20px; }
		.comment { background: #f5f5f5; padding: 10px; margin: 5px 0; border-radius: 5px; }
	</style>
</head>
<body>
	<h1>%s</h1>
	<div class="rating">Average Rating: %s</div>
	
	<h2>Ingredients</h2>
	<ul class="ingredients">`, title, title, ratingStr))

	for _, ingredient := range ingredients {
		html.WriteString(fmt.Sprintf("<li>%s</li>", ingredient))
	}

	html.WriteString(fmt.Sprintf(`
	</ul>
	
	<h2>Instructions</h2>
	<div class="instructions">%s</div>
	
	<h2>Comments</h2>
	<div class="comments">`, instructions))

	if len(comments) == 0 {
		html.WriteString("<p>No comments yet</p>")
	} else {
		for _, comment := range comments {
			html.WriteString(fmt.Sprintf(`<div class="comment">%s</div>`, comment))
		}
	}

	html.WriteString(`
	</div>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func addComment(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeId).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req CommentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Comment == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeId, req.Comment)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add comment"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeId).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var req RatingRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeId, req.Rating)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add rating"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}