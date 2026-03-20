package main

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Recipe struct {
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
	Comments     []Comment `json:"comments"`
	AvgRating    *float64 `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type RecipeInput struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type CommentInput struct {
	Comment string `json:"comment"`
}

type RatingInput struct {
	Rating int `json:"rating"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
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
	app.Post("/recipes/:recipeId/ratings", rateRecipe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecipesOverview(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id, r.title
		ORDER BY r.created_at DESC
		LIMIT 20
	`)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	html := `<!DOCTYPE html>
<html>
<head>
    <title>Recipe Overview</title>
</head>
<body>
    <h1>Recipe Overview</h1>
    <ul>`

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		err := rows.Scan(&id, &title, &avgRating)
		if err != nil {
			continue
		}
		
		ratingStr := "No ratings yet"
		if avgRating.Valid {
			ratingStr = fmt.Sprintf("%.1f/5", avgRating.Float64)
		}
		
		html += fmt.Sprintf(`
        <li>
            <a href="/recipes/%s">%s</a> - Rating: %s
        </li>`, id, title, ratingStr)
	}

	html += `
    </ul>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func uploadRecipe(c *fiber.Ctx) error {
	var input RecipeInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Title == "" || len(input.Ingredients) == 0 || input.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	id := uuid.New().String()
	ingredientsStr := ""
	for i, ing := range input.Ingredients {
		if i > 0 {
			ingredientsStr += "|"
		}
		ingredientsStr += ing
	}

	_, err := db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, input.Title, ingredientsStr, input.Instructions)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create recipe"})
	}

	recipe := Recipe{
		ID:           id,
		Title:        input.Title,
		Ingredients:  input.Ingredients,
		Instructions: input.Instructions,
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
	} else if err != nil {
		return c.Status(500).SendString("Server error")
	}

	// Get comments
	commentRows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ? ORDER BY created_at DESC", recipeId)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer commentRows.Close()

	comments := ""
	for commentRows.Next() {
		var comment string
		if err := commentRows.Scan(&comment); err == nil {
			comments += fmt.Sprintf("<li>%s</li>", comment)
		}
	}

	// Get average rating
	var avgRating sql.NullFloat64
	err = db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeId).Scan(&avgRating)
	if err != nil && err != sql.ErrNoRows {
		return c.Status(500).SendString("Server error")
	}

	ratingStr := "No ratings yet"
	if avgRating.Valid {
		ratingStr = fmt.Sprintf("%.1f/5", avgRating.Float64)
	}

	// Parse ingredients
	ingredients := ""
	for _, ing := range splitIngredients(ingredientsStr) {
		ingredients += fmt.Sprintf("<li>%s</li>", ing)
	}

	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>%s</title>
</head>
<body>
    <h1>%s</h1>
    <p><strong>Rating:</strong> %s</p>
    <h2>Ingredients</h2>
    <ul>%s</ul>
    <h2>Instructions</h2>
    <p>%s</p>
    <h2>Comments</h2>
    <ul>%s</ul>
</body>
</html>`, title, title, ratingStr, ingredients, instructions, comments)

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func addComment(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeId).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input CommentInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Comment == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeId, input.Comment)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add comment"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func rateRecipe(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeId).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input RatingInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Rating < 1 || input.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeId, input.Rating)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to add rating"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}

func splitIngredients(ingredientsStr string) []string {
	ingredients := []string{}
	current := ""
	for _, ch := range ingredientsStr {
		if ch == '|' {
			if current != "" {
				ingredients = append(ingredients, current)
				current = ""
			}
		} else {
			current += string(ch)
		}
	}
	if current != "" {
		ingredients = append(ingredients, current)
	}
	return ingredients
}