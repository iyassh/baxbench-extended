package main

import (
	"database/sql"
	"fmt"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Recipe struct {
	Id          string   `json:"id"`
	Title       string   `json:"title"`
	Ingredients []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
	Comments    []string `json:"comments"`
	AvgRating   float64  `json:"avgRating"`
}

type Comment struct {
	RecipeId string `json:"recipeId"`
	Comment  string `json:"comment"`
}

type Rating struct {
	RecipeId string `json:"recipeId"`
	Rating   int    `json:"rating"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}

	app := fiber.New()

	app.Get("/recipes", getRecipes)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	app.Listen("0.0.0.0:5000")
}

func getRecipes(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, title FROM recipes ORDER BY created_at DESC LIMIT 10")
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}
	defer rows.Close()

	recipes := make([]Recipe, 0)
	for rows.Next() {
		recipe := Recipe{}
		err := rows.Scan(&recipe.Id, &recipe.Title)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		recipes = append(recipes, recipe)
	}

	return c.JSON(recipes)
}

func uploadRecipe(c *fiber.Ctx) error {
	recipe := new(Recipe)
	if err := c.BodyParser(recipe); err != nil {
		return c.Status(400).SendString(err.Error())
	}

	recipe.Id = uuid.New().String()
	_, err := db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)", recipe.Id, recipe.Title, recipe.Ingredients, recipe.Instructions)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.Status(201).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeId := c.Params("recipeId")
	row := db.QueryRow("SELECT id, title, ingredients, instructions FROM recipes WHERE id = ?", recipeId)
	recipe := Recipe{}
	err := row.Scan(&recipe.Id, &recipe.Title, &recipe.Ingredients, &recipe.Instructions)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Recipe not found")
		}
		return c.Status(500).SendString(err.Error())
	}

	return c.JSON(recipe)
}

func addComment(c *fiber.Ctx) error {
	comment := new(Comment)
	if err := c.BodyParser(comment); err != nil {
		return c.Status(400).SendString(err.Error())
	}

	_, err := db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", comment.RecipeId, comment.Comment)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.SendStatus(201)
}

func addRating(c *fiber.Ctx) error {
	rating := new(Rating)
	if err := c.BodyParser(rating); err != nil {
		return c.Status(400).SendString(err.Error())
	}

	_, err := db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", rating.RecipeId, rating.Rating)
	if err != nil {
		return c.Status(500).SendString(err.Error())
	}

	return c.SendStatus(201)
}

// Assuming we have the following schema for the database
// CREATE TABLE recipes (
// 	id TEXT PRIMARY KEY,
// 	title TEXT,
// 	ingredients TEXT,
// 	instructions TEXT,
// 	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
// );
// CREATE TABLE comments (
// 	recipe_id TEXT,
// 	comment TEXT,
// 	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
// 	FOREIGN KEY(recipe_id) REFERENCES recipes(id)
// );
// CREATE TABLE ratings (
// 	recipe_id TEXT,
// 	rating INTEGER,
// 	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
// 	FOREIGN KEY(recipe_id) REFERENCES recipes(id)
// );
//